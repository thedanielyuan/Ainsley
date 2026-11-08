import type { Material, MaterialRole } from "./types";

/**
 * A course's modules: how its files group into weeks, units, lectures or topics. Inferred from
 * the student's own organization (a linked folder's subfolders, numbering in file names like
 * "Week 3 notes" or "Lec05"), with the files that fit neither grouped by what they are. Ainsley
 * sees the outline in the course context and retrieves a module with get_course_module.
 */
export interface CourseModule {
  /** What Ainsley and the student call it: "Week 3", "Thermodynamics", "Problem sets". */
  title: string;
  /** unit: numbered ("Week 3"); folder: a subfolder of the linked folder; group: the rest, by type. */
  kind: "unit" | "folder" | "group";
  materials: Material[];
}

// Numbered series, listed in this order when a course uses several.
const UNITS: Array<{ re: RegExp; label: string }> = [
  { re: /\b(?:week|wk)\s*0*(\d{1,2})(?!\d)/, label: "Week" },
  { re: /\b(?:module|mod)\s*0*(\d{1,2})(?!\d)/, label: "Module" },
  { re: /\bunit\s*0*(\d{1,2})(?!\d)/, label: "Unit" },
  { re: /\btopic\s*0*(\d{1,2})(?!\d)/, label: "Topic" },
  { re: /\b(?:chapter|chap|ch)\s*0*(\d{1,2})(?!\d)/, label: "Chapter" },
  { re: /\b(?:lecture|lect|lec)\s*0*(\d{1,2})(?!\d)/, label: "Lecture" },
  { re: /\bsession\s*0*(\d{1,2})(?!\d)/, label: "Session" },
  { re: /\bclass\s*0*(\d{1,2})(?!\d)/, label: "Class" },
];

// Subfolders named for a kind of file ("Lectures", "Homework") rather than a part of the course:
// numbering in the file names inside them says more.
const TYPE_FOLDER =
  /^(lectures?|lecture (notes|slides)|slides|notes|readings?|textbooks?|books?|papers|articles|homeworks?|hw|assignments?|problem ?sets?|psets?|exercises|worksheets?|tutorials?|labs?|exams?|past (exams|papers)|midterms?|finals?|quiz(zes)?|tests?|solutions?|handouts?|resources|materials|misc|other|photos?|images?|scans?)$/;

const ROLE_ORDER: MaterialRole[] = ["syllabus", "slides", "notes", "reading", "problem-set", "exam", "photo", "other"];

const GROUP_TITLES: Record<MaterialRole, string> = {
  syllabus: "Syllabus and course info",
  slides: "Slides",
  notes: "Notes",
  reading: "Readings",
  "problem-set": "Problem sets",
  exam: "Exams and quizzes",
  photo: "Photos",
  other: "Other files",
};

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[_\-.,()[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The numbered unit a name refers to ("wk03 notes" → Week 3), if any. */
function unitOf(text: string): { series: number; n: number; title: string } | null {
  const clean = normalize(text);
  for (let series = 0; series < UNITS.length; series++) {
    const m = UNITS[series].re.exec(clean);
    if (m) {
      const n = Number(m[1]);
      return { series, n, title: `${UNITS[series].label} ${n}` };
    }
  }
  return null;
}

/** The first folder inside the linked folder that holds this file ("BIO 201/Week 3/x.pdf" → "Week 3"). */
function subfolderOf(m: Material) {
  const parts = m.folderPath?.split("/") ?? [];
  return parts.length >= 3 ? parts[1].trim() || null : null;
}

const byRoleThenName = (a: Material, b: Material) =>
  ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

/** Groups a course's files into modules: numbered units first, then topic folders, then the rest by type. */
export function courseModules(materials: Material[]): CourseModule[] {
  const units = new Map<string, { series: number; n: number; module: CourseModule }>();
  const folders = new Map<string, CourseModule>();
  const groups = new Map<MaterialRole, CourseModule>();

  const addTo = <K,>(map: Map<K, CourseModule>, key: K, title: string, kind: CourseModule["kind"], m: Material) => {
    let mod = map.get(key);
    if (!mod) {
      mod = { title, kind, materials: [] };
      map.set(key, mod);
    }
    mod.materials.push(m);
  };

  for (const m of materials) {
    const folder = subfolderOf(m);
    const topicFolder = folder && !TYPE_FOLDER.test(normalize(folder)) ? folder : null;
    // The student's folders win over file names ("Week 3/Lecture 5.pdf" is in Week 3), except
    // folders that only sort files by type.
    const unit = (folder ? unitOf(folder) : null) ?? (topicFolder ? null : unitOf(m.name));
    if (unit) {
      const key = unit.title.toLowerCase();
      let entry = units.get(key);
      if (!entry) {
        entry = { series: unit.series, n: unit.n, module: { title: unit.title, kind: "unit", materials: [] } };
        units.set(key, entry);
      }
      entry.module.materials.push(m);
    } else if (folder) {
      addTo(folders, folder.toLowerCase(), folder, "folder", m);
    } else {
      addTo(groups, m.role, GROUP_TITLES[m.role], "group", m);
    }
  }

  const ordered = [
    ...[...units.values()].sort((a, b) => a.series - b.series || a.n - b.n).map((u) => u.module),
    ...[...folders.values()].sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" }),
    ),
    ...ROLE_ORDER.map((role) => groups.get(role)).filter((g): g is CourseModule => Boolean(g)),
  ];
  for (const mod of ordered) mod.materials.sort(byRoleThenName);
  return ordered;
}

/** Finds the module Ainsley asked for by name: exact, the same unit ("wk 3", "Week 03"), or a unique partial match. */
export function findModule(modules: CourseModule[], name: string): CourseModule | null {
  const query = normalize(name.replace(/^[“"']|[”"']$/g, ""));
  if (!query) return null;
  const exact = modules.find((mod) => normalize(mod.title) === query);
  if (exact) return exact;
  const unit = unitOf(query);
  const sameUnit = unit && modules.find((mod) => mod.kind === "unit" && mod.title === unit.title);
  if (sameUnit) return sameUnit;
  const partial = modules.filter((mod) => normalize(mod.title).includes(query));
  if (partial.length === 1) return partial[0];
  // A unit filed inside a topic folder ("Thermodynamics/Lecture 9.pdf") is still findable by its number.
  const files = unit ? modules.flatMap((mod) => mod.materials).filter((m) => unitOf(m.name)?.title === unit.title) : [];
  return files.length ? { title: unit!.title, kind: "unit", materials: files } : null;
}
