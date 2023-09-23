import { _noteContent,
  _sectionContent,
} from './amplenote_rw.js';
/*******************************************************************************************/
/* Markdown functions
/*******************************************************************************************/

/*******************************************************************************************
 * Return an Amplenote section object given the text of a heading and optionally its level
 */
export function _sectionFromHeadingText(headingText, { level = 1 } = {}) {
  return { heading: { text: headingText, level }};
}

/*******************************************************************************************
 * Given an object of key: value, create a markdown string where each key is a level 2 heading,
 * and each value is passed through "markdownFunction" as the contents of that heading.
 * 
 * Use this function to convert a dashboard object or a book note object into markdown that can
 * be written to Amplenotes.
 *
 * Necessary mechanism because of Amplenote-side limits on performing writes; splitting into sections
 * allows for smaller write operations.
 */
export function _markdownFromSections(app, sectionEntries, markdownFunction) {
  let markdown = "";
  for (let [key, value] of sectionEntries) {
    markdown += `## ${ key }\n`;
    markdown += markdownFunction(app, value);
  }
  return markdown;
}

/*******************************************************************************************
 * Given a list of highlight objects, return the markdown corresponding to that list.
 */
export function _markdownFromHighlights(app, hls) {
  let markdownLines = [];
  for (let hl of hls) {
    let result = "";
    result += `> ### ${ hl.text }\n\n`;
    // TODO: implement location
    if (hl.note) result += `**Note**: ${ hl.note }\n`;
    if (hl.color) result += `**Highlight color**: ${ hl.color }\n`;
    result += `**Highlighted at**: ${ this._localeDateFromIsoDate(app, hl.highlighted_at) } (#H${ hl.id })\n`;
    markdownLines.push(result);
  }
  return markdownLines.join("\n\n");
}

/*******************************************************************************************
 * Given a list of book items, return a markdown table. Will infer headers from the first 
 * object in that list
 */
export function _markdownFromTable(items) {
  let headers = Object.keys(items[0]);
  let markdown = "";

  // Append table headers
  markdown += this._tablePreambleFromHeaders(headers);

  for (let item of items) {
    markdown += this._markdownFromTableRow(headers, item);
  }

  markdown += '\n';
  return markdown;
}

export function _tablePreambleFromHeaders(headers) {
  let markdown = "";
  markdown += `| ${ headers.map(item => `**${ item }**`).join(' | ') } |\n`;
  markdown += `| ${ headers.map(() => '---').join(' | ') } |\n`;
  return markdown;
}

export function _markdownFromTableRow(headers, item) {
  let row;
  try {
    row = headers.map(header => item[header].replace(/\|/g, ",") || "");
  } catch (err) {
    if (err.name === "TypeError") {
      throw(new Error(`${ err.message } (line 836)`));
    }
  }
  let markdown = `| ${ row.join(' | ') } |\n`;
  return markdown;
}

/*******************************************************************************************
 * Given a note (noteHandle) and a heading name (headingLabel), visit all subsections of the
 * given heading and convert the markdown found in those sections into a list of objects.
 *
 * Returns a flat array of objects (not grouped by their original headings).
 *
 * Calls "entriesFunction" on the found markdown as the markdown-to-object conversion rule.
 */
export async function _sectionsFromMarkdown(noteHandle, headingLabel, entriesFunction) {
  console.debug(`_sectionsFromMarkdown(noteHandle, ${ headingLabel }, entriesFunction)`);
  const noteContent = await _noteContent(noteHandle);
  // This is the book list section
  let mainSectionContent = _sectionContent(noteContent, headingLabel);
  // These will be year sections
  let sections = _getHeadingsFromMarkdown(mainSectionContent);

  let result= [];
  
  for (let section of sections) {
    let yearMarkdownContent = _sectionContent(mainSectionContent, section);
    let entries = entriesFunction(yearMarkdownContent);
    if (!entries) continue;

    result = result.concat(entries);
  }
  return result;
}

/*******************************************************************************************
 * Given a markdown table, return a list of objects. Attemps to deal with occasionaly empty 
 * rows that Amplenote sometimes produces when accessing tables.
 *
 * To be used as the parameter for _sectionsFromMarkdown.
 */
export function _tableFromMarkdown(content) {
  console.debug(`_tableFromMarkdown(${content})`);

  let lines = content.split('\n');
  if (lines.length < 2) return null;

  // Filter out any empty rows or rows that consist only of dashes or pipes
  lines = lines.filter(row => row.trim() !== "" && !row.trim().match(/^\s*\|([-\s]+\|\s*)+$/));

  let headers;
  try {
    headers = lines[0].split("|")
      .slice(1, -1) // Remove first and last empty strings caused by the leading and trailing |
      .map(header => header.trim().replace(new RegExp("\\*", "g"), ""));
  } catch (err) {
    if (err.name === "TypeError") {
      throw(new Error(`${ err.message } (line 887)`));
    }
  }

  // Convert each row into a JavaScript object where each key is a header
  // and each value is the corresponding cell in the row
  const table = lines.slice(1).map(row => {
    const cells = row.split("|")
    .slice(1, -1) // Remove first and last empty strings caused by the leading and trailing |
    .map(cell => cell.trim());

    const rowObj = {};
    headers.forEach((header, i) => {
        rowObj[header] = cells[i] || null;
    });
    return rowObj;
  });

  return table;
}

/*******************************************************************************************
 * Returns a list of Amplenote section objects found in the markdown passed as parameter
 */
export function _getHeadingsFromMarkdown(content) {
  const headingMatches = Array.from(content.matchAll(/^#+\s*([^\n]+)/gm));
  try {
    return headingMatches.map(match => ({
      heading: {
        anchor: match[1].replace(/\s/g, "_"),
        level: match[0].match(/^#+/)[0].length,
        text: match[1],
      }
    }));
  } catch (err) {
    if (err.name === "TypeError") {
      throw(new Error(`${ err.message } (line 923)`));
    }
  }
}

/*******************************************************************************************
 * Returns a markdown heading string given an Amplenote section object
 */
export function _mdSectionFromObject(section) {
  return `${"#".repeat(section.heading.level)} ${section.heading.text}\n`;
}

/*******************************************************************************************
 * Legacy, to be replaced: cleans up Amplenote-exported table
 */
export function _tableStrippedPreambleFromTable(tableContent) {
  try {
    [
      /^([|\s*]+(Cover|Book Title|Author|Category|Source|Highlights|Updated|Other Details)){1,10}[|\s*]*(?:[\r\n]+|$)/gm,
      /^[|\-\s]+(?:[\r\n]+|$)/gm, // Remove top two rows that markdown tables export as of June 2023
    ].forEach(removeString => {
      tableContent = tableContent.replace(removeString, "").trim();
    tableContent = tableContent.replace(/^#+.*/g, ""); // Remove section label if present
    });
  } catch (err) {
    if (err.name === "TypeError") {
      throw(new Error(`${ err.message } (line 949)`));
    }
  }

  return tableContent;
}


