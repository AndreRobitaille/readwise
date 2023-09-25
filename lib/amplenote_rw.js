import { _sectionFromHeadingText } from './amplenote_rw.js';
import { _getHeadingsFromMarkdown,
  _mdSectionFromObject,
} from './markdown.js';

/*******************************************************************************************/
/* Amplenote RW
/*******************************************************************************************/

/*******************************************************************************************
 * Return all of the markdown within a section that begins with `sectionHeadingText`
 * `sectionHeadingText` Text of the section heading to grab, with or without preceding `#`s
 * `depth` Capture all content at this depth, e.g., if grabbing depth 2 of a second-level heading, this will return all potential h3s that occur up until the next h1 or h2
 */
export function _sectionContent(noteContent, headingTextOrSectionObject) {
  console.debug(`_sectionContent()`);
  let sectionHeadingText;
  if (typeof headingTextOrSectionObject === "string") {
    sectionHeadingText = headingTextOrSectionObject;
  } else {
    sectionHeadingText = headingTextOrSectionObject.heading.text;
  }
  try {
    sectionHeadingText = sectionHeadingText.replace(/^#+\s*/, "");
  } catch (err) {
    if (err.name === "TypeError") {
      throw(new Error(`${ err.message } (line 1054)`));
    }
  }
  const { startIndex, endIndex } = _sectionRange(noteContent, sectionHeadingText);
  return noteContent.slice(startIndex, endIndex);
}

/******************************************************************************************
 * All content replacing is routed through this function so that we can swap between interfacing with the note
 * directly, and using local strings for faster replace operations (no image flashing)
 * */
export async function _replaceContent(note, sectionHeadingText, newContent, { level = 1 } = {}) {
  console.log(`_replaceContent() with this._useLocalNoteContents=${this._useLocalNoteContents}`);
  const replaceTarget = _sectionFromHeadingText(sectionHeadingText, { level });
  if (this._useLocalNoteContents) {
    let throughLevel = replaceTarget.heading?.level;
    if (!throughLevel) throughLevel = sectionHeadingText.match(/^#*/)[0].length;
    if (!throughLevel) throughLevel = 1;

    const bodyContent = this._noteContents[note.uuid];
    const { startIndex, endIndex } = _sectionRange(bodyContent, sectionHeadingText);

    if (startIndex) {
      const revisedContent = `${ bodyContent.slice(0, startIndex) }\n${ newContent }${ bodyContent.slice(endIndex) }`;
      this._noteContents[note.uuid] = revisedContent;
    } else {
      throw new Error(`Could not find section ${ sectionHeadingText } in note ${ note.name }`);
    }
  } else {
    await note.replaceContent(newContent, replaceTarget);
  }
}

/*******************************************************************************************
 * Return {startIndex, endIndex} where startIndex is the index at which the content of a section
 * starts, and endIndex the index at which it ends.
 */
export function _sectionRange(bodyContent, sectionHeadingText) {
  console.debug(`_sectionRange`);
  const indexes = Array.from(bodyContent.matchAll(this.constants.sectionRegex));
  const sectionMatch = indexes.find(m => m[1].trim() === sectionHeadingText.trim());
  if (!sectionMatch) {
    console.error("Could not find section", sectionHeadingText, "that was looked up. This might be expected");
    return { startIndex: null, endIndex: null };
  } else {
    const level = sectionMatch[0].match(/^#+/)[0].length;
    const nextMatch = indexes.find(m => m.index > sectionMatch.index && m[0].match(/^#+/)[0].length <= level);
    const endIndex = nextMatch ? nextMatch.index : bodyContent.length;
    return { startIndex: sectionMatch.index + sectionMatch[0].length + 1, endIndex };
  }
}

/*******************************************************************************************
 * Adds markdown ("newContent") to a "note", optionally at the end of the note ("atEnd" = true).
 * Handles in-memory buffering.
 */
export async function _insertContent(note, newContent, { atEnd = false } = {}) {
  if (this._useLocalNoteContents) {
    const oldContent = this._noteContents[note.uuid] || "";
    if (atEnd) {
      this._noteContents[note.uuid] = `${ oldContent.trim() }\n${ newContent }`;
    } else {
      this._noteContents[note.uuid] = `${ newContent.trim() }\n${ oldContent }`;
    }
  } else {
    await note.insertContent(newContent, { atEnd });
  }
}

/*******************************************************************************************
 * Returns Amplenote section objects given a note object.
 * Handles in-memory buffering.
 */
export async function _sections(note, { minIndent = null } = {}) {
  console.debug(`_sections()`);
  let sections;
  if (this._useLocalNoteContents) {
    const content = this._noteContents[note.uuid];
    sections = _getHeadingsFromMarkdown(content);
  } else {
    sections = await note.sections();
  }

  if (Number.isInteger(minIndent)) {
    sections = sections.filter(section => (section.heading?.level >= minIndent) && section.heading.text.trim().length) || [];
    return sections;
  } else {
    return sections;
  }

}

/*******************************************************************************************
 * Returns the markdown content from a note object.
 * Handles in-memory buffering.
 */
export async function _noteContent(note) {
  if (this._useLocalNoteContents) {
    if (typeof this._noteContents[note.uuid] === "undefined") {
      // Don't load too many notes in memory
      if (Object.keys(this._noteContents).length >= this.constants.maxBookLimitInMemory) {
        await _flushLocalNotes(this._app);
      }
      this._noteContents[note.uuid] = await note.content();
    }
    return this._noteContents[note.uuid];
  } else {
    return await note.content();
  }
}

/*******************************************************************************************
 * Write in-memory buffers to amplenotes. Writes section-by-section to avoid maxing out write
 * limits.
 */
export async function _flushLocalNotes(app) {
  console.log("_flushLocalNotes(app)");
  for (const uuid in this._noteContents) {
    console.log(`Flushing ${uuid}...`);
    const note = await app.notes.find(uuid);
    let content = this._noteContents[uuid];
    if (!note.uuid.includes("local-")) {
      // The note might be persisted to the sever, in which case its uuid changed
      // In order to properly use the note later, we need to refer to it by its newer uuid
      this._noteContents[note.uuid] = content;
    }
    let newContent = "";

    // Replace note content with section names only, to avoid exceeding Amplenote write limit
    // NOTE: this._useLocaLNoteContents has to be true here; might want to fix this dependency eventually
    let sections = await _sections(note);
    console.debug(`Inserting sections ${sections.toString()}...`);
    for (const section of sections) {
      newContent = `${newContent}${_mdSectionFromObject(section)}`;
    }
    await app.replaceNoteContent({uuid: note.uuid}, newContent);

    // Replace individual sections with section content
    sections = _findLeafNodes(sections);
    for (const section of sections) {
      console.debug(`Inserting individual section content for ${section.heading.text}...`);
      let newSectionContent = _sectionContent(content, section);
      await app.replaceNoteContent({uuid: note.uuid}, newSectionContent, {section});
    }
    delete this._noteContents[uuid];
    delete this._noteContents[note.uuid];
  }
}

/*******************************************************************************************
 * Given a list of heading objects, returns only the ones that are "leafs" (eg. have no 
 * subheadings.
 */
export function _findLeafNodes(depths) {
  let leafNodes = [];

  for (let i = 0; i < depths.length - 1; i++) {
    if (depths[i + 1].heading.level <= depths[i].heading.level) {
      leafNodes.push(depths[i]);
    }
  }

  // Add the last node if it's not already included (it's a leaf by default)
  if (depths.length > 0 && (leafNodes.length === 0 || leafNodes[leafNodes.length - 1].heading.level !== depths.length - 1)) {
    leafNodes.push(depths[depths.length - 1]);
  }

  return leafNodes;
}

/*******************************************************************************************
 * Transform text block to lower-cased dasherized text
 */
export function _textToTagName(text) {
  console.log("_textToTagName", text);
  if (!text) return null;
  try {
    return text.toLowerCase().trim().replace(/[^a-z0-9\/]/g, "-");
  } catch (err) {
    if (err.name === "TypeError") {
      throw(new Error(`${ err.message } (line 1234)`));
    }
  }
}

