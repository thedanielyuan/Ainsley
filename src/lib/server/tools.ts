import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { EVALUATE_TOOL, MODULE_TOOL, OPEN_TOOL, SEARCH_TOOL } from "@/lib/tool-names";

/**
 * Ainsley's tools. The model picks among them by what the student is trying to do (see "Your
 * tools" in the system prompt); the descriptions say when each one is the right choice.
 *
 * Declared identically on every request, from a chat's first turn: the tool set is part of the
 * prefix that preserved thinking and the prompt cache are bound to. The course tools and
 * evaluate_answer run in the browser (where the library lives; answer checks go on to
 * /api/evaluate); web search and fetch run on Anthropic's side.
 */

// Homework-answer sites: unreliable, and reading their solutions would do the student's
// thinking for them. (Web search accepts paths; web fetch takes hostnames only.)
const ANSWER_SITES = [
  "chegg.com",
  "coursehero.com",
  "brainly.com",
  "studocu.com",
  "numerade.com",
  "bartleby.com",
  "transtutors.com",
  "homeworklib.com",
  "studypool.com",
  "slader.com",
  "gauthmath.com",
];

export const TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  {
    name: SEARCH_TOOL,
    description:
      "Search the student's own course materials — lecture slides, notes, readings, problem sets, past exams, and files attached in this chat — for passages relevant to a query. " +
      "Returns the best-matching excerpts, each labeled with its file and page or slide, which you can cite. " +
      "Use it before explaining anything their course covers, so you teach it the way this course does: its notation, definitions, methods, and scope. " +
      "Photos and scanned PDFs are searched by their transcribed text, which can contain recognition errors: open the file when exact symbols, wording, or a figure matter. " +
      "If results are thin, search again with different wording or the course's own terms.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            'What to look for, in specific terms: key technical words, names, or a distinctive phrase (e.g. "Michaelis-Menten Km definition" rather than "enzymes").',
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: OPEN_TOOL,
    description:
      "Open one of the student's course files by its id from the course context. " +
      "PDFs up to 100 pages are shown whole — page images plus text — so you can see diagrams, equations, and layout; photos are shown as images; slides and documents return their text. " +
      "For longer files, or to read just part of one, pass `pages` (a scan's pages then come as their transcribed text). " +
      "Use it when you need a whole problem set or worked example, a figure, or the original of a photo or scan; use search to find things.",
    input_schema: {
      type: "object",
      properties: {
        material_id: { type: "string", description: 'The file\'s id from the course context, e.g. "k3f9a2b7c1".' },
        pages: {
          type: "string",
          description: 'Optional. Pages, slides, or sections to read, e.g. "4", "3-7", or "2, 5, 9" (up to 30).',
        },
      },
      required: ["material_id"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: MODULE_TOOL,
    description:
      "Retrieve one module of the student's course — a week, unit, lecture, chapter, topic folder, or group of files, as listed in the course outline in the course context — with the text of all its files, in order, as citable passages. " +
      "Use it when a request is about a whole part of the course rather than one idea: summarizing or reviewing a week or lecture, making a quiz or practice set on a unit, planning revision for an exam, or seeing what a module covers. " +
      "Returns up to about 25,000 tokens; a longer module comes back as each file's opening pages (each passage's title names its file and page), so open the rest with open_course_material if you need it. " +
      "Photos and scans come back as their transcribed text; open them to see the originals. For one concept or definition, search_course_materials is faster.",
    input_schema: {
      type: "object",
      properties: {
        module: {
          type: "string",
          description: 'The module\'s name as the course outline gives it, e.g. "Week 3", "Lecture 5", "Thermodynamics", or "Exams and quizzes".',
        },
      },
      required: ["module"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: EVALUATE_TOOL,
    description:
      "Have an independent grader check a student's answer or worked solution. It solves the problem itself, verifies calculations, algebra, and code by running Python, accepts equivalent forms and other valid methods, and returns a verdict (correct, partially correct, incorrect, incomplete), what's right, the first error with the misconception likely behind it, and a hint toward it. " +
      "Use it whenever the student offers a substantive attempt — a calculation, derivation, proof, code, a multi-step solution, or an explanation to judge against key ideas — before you tell them whether it's right. Judge quick recall answers (a term, a single fact) yourself. " +
      "If their materials might hold an answer key, worked solution, or marking scheme for the problem, find it first and pass it as `reference`. " +
      "Photos and short PDFs attached to the student's latest message are shown to the grader too. The assessment is for you, not the student.",
    input_schema: {
      type: "object",
      properties: {
        problem: {
          type: "string",
          description:
            "The question or task exactly as the student was given it — from their materials, their message, or a practice question you set — with all given values and conditions and what is asked. Quote it when it comes from a file.",
        },
        student_answer: {
          type: "string",
          description:
            "The student's answer and working, verbatim: every step they showed, in their notation, mistakes included. Transcribe a photo exactly; don't fix or tidy anything.",
        },
        reference: {
          type: "string",
          description:
            "Optional. An answer key, worked solution, or marking scheme from their course materials. Leave it out if you didn't find one; don't write your own.",
        },
        course_expectations: {
          type: "string",
          description:
            "Optional. What their course requires that affects marking: a required method, notation, units, significant figures, or what counts as a complete proof.",
        },
      },
      required: ["problem", "student_answer"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    type: "web_search_20260209",
    name: "web_search",
    // Room to gather real options when a student asks for videos or readings.
    max_uses: 8,
    blocked_domains: [...ANSWER_SITES, "quizlet.com/explanations"],
  },
  {
    type: "web_fetch_20260209",
    name: "web_fetch",
    max_uses: 4,
    blocked_domains: ANSWER_SITES,
    citations: { enabled: true },
    max_content_tokens: 30_000,
  },
];
