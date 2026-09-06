// The prose for the per-format pages. The facts that can go stale (which extensions a
// format claims, which editor opens it, whether it is read-only) are NOT here: the
// generator reads those from the format modules the app itself registers, and refuses to
// build a page for an id the app no longer has. What lives here is the part no registry can
// know, which is why someone arriving from a search box should care.
//
// Keep an entry honest. If Omnitext only reads a format, say reads, not edits.

/**
 * @typedef {object} FormatPage
 * @property {string} id        Page slug, used for the URL.
 * @property {string[]} formats Registry ids this page speaks for; every one must exist in
 *                              the app, and their extensions are what the page lists.
 * @property {string} name      How people say it ("Word document", not "docx").
 * @property {string} headline  Page <h1> and <title> lead.
 * @property {string} summary   Meta description; one sentence, under ~155 characters.
 * @property {string} lead      Opening paragraph.
 * @property {string[]} can     What you can actually do, most useful first.
 * @property {string} [note]    A caveat or a detail worth knowing. Optional.
 */

/** @type {FormatPage[]} */
export const PAGES = [
  {
    id: "pdf",
    formats: ["pdf"],
    name: "PDF",
    headline: "Edit a PDF in your browser",
    summary:
      "Open a PDF, edit its text, add pages or images, and save it back. Nothing is uploaded: the file stays on your device.",
    lead: "Most sites that edit PDFs ask you to upload the file to their server first. Omnitext does the work in the browser instead, so the document never leaves your machine, and there is no account, no watermark and no page limit.",
    can: [
      "Change the text that is already on the page, keeping the original font where it can be reused",
      "Add, delete, rotate and reorder pages",
      "Place images and draw over the page",
      "Cover something up rather than leaving it readable underneath",
      "Fill in and keep form fields",
      "Print, or export back to PDF at full quality",
    ],
    note: "Scanned pages are pictures of text, not text. Omnitext shows and rearranges them, but the words in a scan cannot be retyped until they have been recognised.",
  },
  {
    id: "docx",
    formats: ["docx", "doc"],
    name: "Word document",
    headline: "Open and edit a .docx without Word",
    summary:
      "Edit Word documents in the browser, keeping the parts you did not touch exactly as they were. No account, no upload.",
    lead: "A .docx is a zip of XML. Omnitext edits the document inside it and writes the archive back, so everything you did not touch stays byte for byte as the original had it, including the parts Omnitext does not itself understand.",
    can: [
      "Edit text with headings, bold, italic, lists, tables and links",
      "See and add comments, with your name from Settings as the author",
      "Insert images",
      "Track what changed against the version you opened",
      "Print or save as PDF",
    ],
    note: "Files still in the old binary .doc format open read-only. Save them as .docx from any word processor to edit them here.",
  },
  {
    id: "odt",
    formats: ["odt"],
    name: "OpenDocument text",
    headline: "Open and edit an .odt in your browser",
    summary:
      "Edit OpenDocument text files from LibreOffice or OpenOffice, in the browser, with the rest of the document left intact.",
    lead: "Omnitext opens .odt through the same editor as Word documents, so the two behave alike, and writes the file back in place rather than regenerating it from scratch.",
    can: [
      "Edit text with headings, bold, italic, lists, tables and links",
      "Insert images",
      "Print or save as PDF",
      "Move between .odt and .docx by saving under the other name",
    ],
  },
  {
    id: "xlsx",
    formats: ["xlsx", "xls"],
    name: "Excel spreadsheet",
    headline: "Edit an .xlsx and keep the formulas working",
    summary:
      "A browser spreadsheet editor that preserves formulas and recalculates them, then writes the workbook back in place.",
    lead: "Most browser spreadsheet viewers show you values and lose the formulas behind them. Omnitext keeps the formulas, recalculates when you change a cell they depend on, and writes the workbook back without disturbing the sheets and settings you never opened.",
    can: [
      "Edit cells across several sheets, with the tabs along the bottom",
      "Keep existing formulas and write new ones, recalculated as you type",
      "Sort and edit large sheets without loading them into a server",
      "Save back to .xlsx, or export the sheet as CSV",
    ],
    note: "The older binary .xls opens too, through a simpler table view that does not carry formulas.",
  },
  {
    id: "ods",
    formats: ["ods"],
    name: "OpenDocument spreadsheet",
    headline: "Edit an .ods spreadsheet in the browser",
    summary:
      "Open OpenDocument spreadsheets, edit cells, keep formulas recalculating, and save the file back.",
    lead: "The same spreadsheet editor that handles .xlsx reads and writes .ods, so a LibreOffice Calc file behaves exactly like an Excel one here.",
    can: [
      "Edit cells across several sheets",
      "Keep and recalculate formulas",
      "Save back to .ods, or to .xlsx by renaming",
    ],
  },
  {
    id: "csv",
    formats: ["csv"],
    name: "CSV",
    headline: "Open a CSV as a table, or as text",
    summary:
      "Edit CSV files in a grid or as raw text, with the separator and quoting detected from the file itself.",
    lead: "Omnitext works out the separator, the quoting and the line endings from the file rather than assuming commas, and gives you both a grid to edit in and the raw text underneath.",
    can: [
      "Edit in a grid, with rows and columns you can insert and delete",
      "Switch to the raw text at any time and back",
      "Keep the separator and quoting style the file arrived with",
      "Open files far larger than a spreadsheet page would show comfortably",
    ],
  },
  {
    id: "dwg",
    formats: ["dwg"],
    name: "DWG drawing",
    headline: "Open a DWG drawing without AutoCAD",
    summary:
      "View AutoCAD DWG drawings in the browser: pan, zoom, switch layers on and off, and print the area you mark.",
    lead: "DWG is AutoCAD's own format, and viewing one usually means installing something. Omnitext reads it in the browser, off the main thread so the page stays responsive while a large drawing loads.",
    can: [
      "Pan and zoom around the drawing",
      "Turn individual layers on and off",
      "Mark out a rectangle and print just that area",
      "Open the file on a phone as easily as on a desktop",
    ],
    note: "Drawings open for viewing and printing. Omnitext does not write DWG back.",
  },
  {
    id: "dxf",
    formats: ["dxf"],
    name: "DXF drawing",
    headline: "Open a DXF drawing in the browser",
    summary:
      "View DXF CAD drawings with layers, pan and zoom, and print a marked area. Nothing is uploaded.",
    lead: "DXF is the interchange format most CAD tools can export, and Omnitext renders it through the same viewer as DWG, so both behave the same way.",
    can: [
      "Pan and zoom around the drawing",
      "Turn individual layers on and off",
      "Mark out a rectangle and print just that area",
    ],
    note: "Drawings open for viewing and printing. Omnitext does not write DXF back.",
  },
  {
    id: "epub",
    formats: ["epub"],
    name: "EPUB book",
    headline: "Read an EPUB in your browser",
    summary: "Open EPUB ebooks and read them page by page, with no reader app and no account.",
    lead: "Omnitext lays an EPUB out as pages you can turn with the arrows or the keyboard, rendering the book's own styling.",
    can: [
      "Turn pages with the on-screen arrows or the arrow keys",
      "Read on a phone as comfortably as on a desktop",
      "Keep the book on your device: nothing is sent anywhere",
    ],
    note: "Books open for reading. Scripts inside a book never run.",
  },
  {
    id: "srt",
    formats: ["srt"],
    name: "SRT subtitles",
    headline: "Edit .srt subtitles in your browser",
    summary:
      "Edit subtitle timing and text in a proper cue editor, with the video beside it, and save the file back unchanged elsewhere.",
    lead: "Omnitext opens subtitles in an editor built for them: a list of cues, a detail panel for the one you are on, and a waveform timeline you can drag a cue along to retime it.",
    can: [
      "Edit cue text and timings, one cue at a time",
      "Open the video beside the subtitles and watch the current cue follow along",
      "Drag cues on a waveform to retime them against what you can hear",
      "Convert between subtitle formats by saving under another name",
    ],
  },
  {
    id: "vtt",
    formats: ["vtt"],
    name: "WebVTT subtitles",
    headline: "Edit .vtt subtitles in your browser",
    summary:
      "Open WebVTT subtitle files, fix timings and text with the video beside them, and save the file back.",
    lead: "WebVTT is the subtitle format the web itself uses. Omnitext edits it in the same cue editor as every other subtitle format, so moving between them is a matter of the name you save under.",
    can: [
      "Edit cue text and timings",
      "Watch the video beside the cue list, with the current cue highlighted",
      "Drag cues on a waveform to retime them",
      "Save as .srt or .ass instead, when a player wants one of those",
    ],
  },
  {
    id: "ass",
    formats: ["ass"],
    name: "ASS/SSA subtitles",
    headline: "Edit .ass subtitles, styles and all",
    summary:
      "Edit Advanced SubStation subtitles in the browser, with styles preserved and the video rendered as it will look.",
    lead: "ASS carries styling, not just text, and a plain text editor is the wrong tool for it. Omnitext keeps the styles, lets you pick which one a cue uses, and renders the preview the way a player will.",
    can: [
      "Edit cue text and timings without disturbing the style definitions",
      "Assign a style to a cue from the ones the file defines",
      "Preview the video with the subtitles drawn as a player would draw them",
      "Drag cues on a waveform to retime them",
    ],
  },
  {
    id: "geojson",
    formats: ["geojson"],
    name: "GeoJSON",
    headline: "Edit GeoJSON on a map, in the browser",
    summary:
      "Open GeoJSON on an interactive map, move and edit features, and save the file back without reformatting it.",
    lead: "Omnitext draws GeoJSON on a map you can edit directly, and writes changes back into the original text rather than reprinting the whole file, so the parts you did not touch keep their formatting.",
    can: [
      "See the features on a map and pan and zoom around them",
      "Move, edit and delete features on the map itself",
      "Edit the raw JSON when that is quicker",
      "Save without your file being reformatted end to end",
    ],
  },
  {
    id: "kml",
    formats: ["kml", "kmz"],
    name: "KML",
    headline: "Open a KML file on a map",
    summary:
      "View and edit KML and KMZ from Google Earth on an interactive map, in the browser, with nothing uploaded.",
    lead: "KML is what Google Earth exports. Omnitext puts it on a map you can work with directly, and reads the zipped KMZ form as well.",
    can: [
      "See placemarks, paths and shapes on a map",
      "Move and edit features directly on the map",
      "Open .kmz without unzipping it first",
    ],
  },
  {
    id: "gpx",
    formats: ["gpx"],
    name: "GPX track",
    headline: "Open a GPX track from your watch or GPS",
    summary:
      "View GPX tracks and waypoints on a map in the browser, edit them, and save the file back.",
    lead: "GPX is what a running watch, a bike computer or a handheld GPS writes. Omnitext shows the track on a map without you signing up to a fitness service to look at your own data.",
    can: [
      "See the track and its waypoints on a map",
      "Edit and delete points",
      "Keep the file on your device rather than uploading it to a platform",
    ],
  },
  {
    id: "svg",
    formats: ["svg"],
    name: "SVG",
    headline: "Edit an SVG in your browser",
    summary:
      "Open SVG vector graphics in a real vector editor, or edit the markup directly, and save the file back.",
    lead: "Omnitext opens SVG in a vector editor with shapes, paths and text, and keeps the underlying markup a click away for when editing it by hand is faster.",
    can: [
      "Draw and edit shapes, paths and text",
      "Edit the markup directly and see the result",
      "Export to PNG",
    ],
  },
  {
    id: "eml",
    formats: ["eml"],
    name: "Email message",
    headline: "Open an .eml file without an email client",
    summary:
      "Read .eml email files in the browser, with attachments, and with remote images blocked so nothing phones home.",
    lead: "An .eml is a saved email. Omnitext shows it as the message it is, and renders the HTML body in a sandbox that blocks remote content, so tracking pixels never load and opening the file tells the sender nothing.",
    can: [
      "Read the message with its sender, recipients, date and subject",
      "Save the attachments",
      "Read HTML mail without any of its remote images loading",
    ],
  },
  {
    id: "msg",
    formats: ["msg"],
    name: "Outlook message",
    headline: "Open an Outlook .msg file without Outlook",
    summary:
      "Read Outlook .msg files in the browser, with attachments listed, and no remote content loaded.",
    lead: "A .msg is Outlook's own format and usually needs Outlook to open. Omnitext reads it directly and shows the message, with the same sandbox that keeps remote images from loading.",
    can: [
      "Read the message with its sender, recipients and subject",
      "See what was attached",
      "Read it on a machine with no mail client installed",
    ],
  },
  {
    id: "sqlite",
    formats: ["sqlite"],
    name: "SQLite database",
    headline: "Browse a SQLite database in your browser",
    summary:
      "Open a .sqlite or .db file, look through its tables, and run queries, without installing a database tool.",
    lead: "Omnitext opens a SQLite file and lets you look inside it: the tables it holds, the rows in them, and whatever a query returns. The file stays on your device.",
    can: [
      "List the tables and browse their rows",
      "Run SQL queries against the file",
      "Open a database from an app backup without any tooling",
    ],
  },
  {
    id: "ipynb",
    formats: ["ipynb"],
    name: "Jupyter notebook",
    headline: "Read a Jupyter notebook without Jupyter",
    summary:
      "Open .ipynb notebooks in the browser and read the code, the prose and the saved output together.",
    lead: "A notebook is JSON, and reading one as raw JSON is miserable. Omnitext renders the cells, the markdown and the output that was saved with them, so you can read a notebook someone sent you without starting a kernel.",
    can: [
      "Read code cells, markdown and saved output in order",
      "See charts and tables that were saved with the notebook",
      "Fall back to the raw JSON when you need it",
    ],
    note: "Notebooks open for reading. Nothing is executed, which is also why opening one is safe.",
  },
  {
    id: "parquet",
    formats: ["parquet"],
    name: "Parquet",
    headline: "Look inside a Parquet file in the browser",
    summary:
      "Open Apache Parquet data files and browse the rows and columns, with no database and no upload.",
    lead: "Parquet is a columnar data format that normally needs a data stack to inspect. Omnitext reads it in the browser and shows you the contents as a table.",
    can: [
      "Browse rows and columns",
      "Check what is actually in a file before wiring it into a pipeline",
      "Keep the data on your machine while you look at it",
    ],
  },
  {
    id: "psd",
    formats: ["psd"],
    name: "Photoshop file",
    headline: "Open a .psd without Photoshop",
    summary: "View Photoshop PSD files in the browser to see what is in them, with nothing uploaded.",
    lead: "Omnitext renders a PSD so you can see the artwork without a Photoshop licence, which is usually all you need when someone sends you one.",
    can: [
      "See the composed image",
      "Check a file you were sent before asking for another format",
      "Export what you see as an image",
    ],
    note: "PSD opens for viewing. Editing layers is Photoshop's job.",
  },
  {
    id: "heic",
    formats: ["heic"],
    name: "HEIC photo",
    headline: "Open a HEIC photo from an iPhone",
    summary:
      "View HEIC and HEIF photos in the browser and convert them to JPEG or PNG, without uploading your pictures.",
    lead: "iPhones save photos as HEIC, and plenty of software still cannot open them. Omnitext decodes them in the browser, so converting a photo does not mean handing it to a website.",
    can: [
      "See the photo",
      "Save it as JPEG or PNG instead",
      "Convert your own pictures without uploading them anywhere",
    ],
  },
  {
    id: "dicom",
    formats: ["dicom"],
    name: "DICOM image",
    headline: "Open a DICOM medical image",
    summary:
      "View DICOM (.dcm) medical images in the browser. The file never leaves your device, which for medical data is the point.",
    lead: "DICOM is what a scanner writes to the disc a hospital hands you. Omnitext displays it without installing a viewer, and without the file going anywhere: for medical images that matters more than convenience.",
    can: [
      "See the image and its metadata",
      "Open the file straight from the disc or the folder you were given",
      "Look at your own scan without uploading it to a service",
    ],
    note: "This is a viewer for looking at a file, not a diagnostic tool.",
  },
  {
    id: "video",
    name: "video",
    formats: ["mp4", "mkv", "mov", "avi", "webmv", "wmv", "ogv", "3gp", "mpegts"],
    headline: "Play a video file in your browser",
    summary:
      "Play MP4, MKV, MOV, AVI and more in the browser, with subtitles, and without uploading the file anywhere.",
    lead: "Omnitext plays a video straight from your disk, streaming it as it goes, so a film-sized file never has to be loaded into memory or handed to a website. When the browser cannot play the container, it repackages the stream on the fly rather than giving up, without re-encoding and without touching the original.",
    can: [
      "Play a file straight from your disk, however large it is",
      "Watch containers the browser will not open on its own, repackaged as they play",
      "Show subtitles, both the ones embedded in the file and a separate subtitle file",
      "Hear audio tracks the browser cannot decode by itself, including Dolby AC-3",
      "Open the subtitle file itself, in the same app, to fix a line or the timing",
    ],
    note: "Video opens for playing, not editing. Nothing is uploaded and nothing is converted on a server: the file stays on your device the whole time.",
  },
  {
    id: "audio",
    name: "audio",
    formats: ["mp3", "flac", "wav", "m4a", "aac", "oga", "weba", "mka", "wma"],
    headline: "Play an audio file in your browser",
    summary:
      "Play MP3, FLAC, WAV, M4A and more in the browser. Nothing is uploaded, and nothing needs installing.",
    lead: "Omnitext plays audio from your disk without an app, a plugin or an upload, including formats a browser will not normally take, such as Apple Lossless.",
    can: [
      "Play a file straight from your disk",
      "Play lossless formats, including FLAC and Apple Lossless",
      "Open a file someone sent you without installing a player for it",
    ],
  },
  {
    id: "code",
    name: "source code",
    formats: [
      "javascript", "typescript", "python", "c", "cpp", "java", "csharp", "php", "rust",
      "go", "ruby", "swift", "kotlin", "sql", "shell", "html", "css", "yaml", "xml",
      "toml", "ini", "vue", "svelte", "powershell", "lua", "perl", "haskell", "scala",
      "dart", "clojure", "erlang", "graphql", "asciidoc", "log", "diff",
    ],
    headline: "Open a code file with syntax highlighting",
    summary:
      "Read and edit source code in the browser with syntax highlighting for 70+ languages. No upload, no account, works offline.",
    lead: "Omnitext opens source files in a real code editor rather than a plain text box: syntax highlighting, bracket matching, folding and search, for over seventy languages. It runs entirely in the browser, which matters when the file has credentials or customer data in it and pasting it into an online viewer is not an option.",
    can: [
      "Read and edit with highlighting, folding, bracket matching and search",
      "Open a language you did not install anything for",
      "Work on a file with secrets in it without it leaving your machine",
      "Open a log or a diff and have it highlighted too",
      "Keep working with the page offline once it has loaded",
    ],
    note: "Anything Omnitext does not have a language for still opens as plain text, so no source file fails to open.",
  },
  {
    id: "markdown",
    formats: ["markdown"],
    name: "Markdown",
    headline: "Write Markdown in your browser",
    summary:
      "A Markdown editor that shows formatting as you type, works offline, and saves plain .md back to your disk.",
    lead: "Omnitext edits Markdown with the formatting rendered as you type, and saves plain Markdown back, so the file stays readable by everything else you use.",
    can: [
      "Write with headings, lists, links, tables and code blocks rendered live",
      "Edit the raw text when you prefer it",
      "Print or save as PDF",
      "Work entirely offline once the page has loaded",
    ],
  },
  {
    id: "latex",
    formats: ["latex"],
    name: "LaTeX",
    headline: "Edit and preview LaTeX in the browser",
    summary:
      "Write LaTeX with a live preview, in the browser, with no distribution to install and no account.",
    lead: "Omnitext edits .tex with the document rendered beside it, which covers reading and correcting a paper without installing a full TeX distribution first.",
    can: [
      "Edit the source with a live preview",
      "Read a .tex someone sent you without setting up TeX",
      "Print or save as PDF",
    ],
    note: "The preview covers common document structure and maths, not every package a full distribution offers.",
  },
  {
    id: "json",
    formats: ["json"],
    name: "JSON",
    headline: "Open and edit JSON in your browser",
    summary:
      "A JSON editor with syntax highlighting and validation that tells you where the file is broken, offline.",
    lead: "Omnitext edits JSON with highlighting and error reporting, and opens files that are too large to paste into an online formatter comfortably. Nothing is uploaded, which matters when the JSON has keys or customer data in it.",
    can: [
      "Edit with highlighting, folding and bracket matching",
      "See exactly where a malformed file breaks",
      "Work on files containing secrets without pasting them into a website",
    ],
  },
];
