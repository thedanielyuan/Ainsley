import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import {
  CHECK_TOOL,
  EVALUATE_TOOL,
  MODULE_TOOL,
  OPEN_TOOL,
  PREREQUISITES_TOOL,
  SEARCH_TOOL,
  SIMULATION_TOOL,
  SOLVE_TOOL,
} from "@/lib/tool-names";

/**
 * Ainsley's tools. The model picks among them by what the student is trying to do (see "Your
 * tools" in the system prompt); the descriptions say when each one is the right choice.
 *
 * Declared identically on every request, from a chat's first turn: the tool set is part of the
 * prefix that preserved thinking and the prompt cache are bound to. The course tools,
 * solve_problem, evaluate_answer, check_math, show_simulation and trace_prerequisites run in the
 * browser (where the library, saved solutions and the student's knowledge map live; solving goes
 * on to /api/solve, answer checks to /api/evaluate, math checks to /api/check, prerequisite maps
 * to /api/prerequisites, and a simulation is drawn in the reply); web search and fetch run on
 * Anthropic's side.
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
      "Open one of the student's course files by its id from the course context, or from a prerequisite map (which can point to a file in another of their courses). " +
      "PDFs up to 100 pages are shown whole — page images plus text — so you can see diagrams, equations, and layout; photos are shown as images; slides and documents return their text. " +
      "For longer files, or to read just part of one, pass `pages` (a scan's pages then come as their transcribed text). " +
      "Use it when you need a whole problem set or worked example, a figure, or the original of a photo or scan, or to teach a prerequisite from where their course taught it; use search to find things.",
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
    name: SOLVE_TOOL,
    description:
      "Work out a verified solution to a problem before you guide the student through it, show a worked example, or set it as practice. Two solvers work it independently, verifying calculations, algebra, and code by running Python; their answers are compared, checked against an answer key from their materials if you pass one, and any difference is settled or flagged. " +
      "Returns, for you rather than the student: whether it's verified, the final answers, the steps a student would write, what a complete answer must contain, and a problem id to pass to evaluate_answer when the student attempts it. " +
      "Use it for multi-step problems: calculations, derivations, proofs, code. For a single result you're about to state (a value, one calculation, an identity, a step of an explanation, the answer to a quick practice question), use check_math instead; a conceptual question with no math to state needs neither. A new problem takes from about 15 seconds to a couple of minutes to solve; the same problem again returns the saved solution. " +
      "Photos and short PDFs attached to the student's latest message are shown to the solvers too.",
    input_schema: {
      type: "object",
      properties: {
        problem: {
          type: "string",
          description:
            "The problem exactly as the student was given it — from their materials, their message, or a practice question you're writing — with every given value and condition and what is asked. Quote it when it comes from a file.",
        },
        reference: {
          type: "string",
          description:
            "Optional. An answer key, worked solution, or marking scheme for this problem from their course materials. Leave it out if you didn't find one; don't write your own.",
        },
        course_expectations: {
          type: "string",
          description:
            "Optional. What their course requires: a method, notation, units, significant figures, or what counts as a complete proof.",
        },
      },
      required: ["problem"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: EVALUATE_TOOL,
    description:
      "Have an independent checker mark a student's answer or worked solution step by step. Each step of their working comes back marked (correct, an error, following from an earlier error, missing a justification, or unreadable), with calculations, algebra, and code verified by running Python and equivalent forms and other valid methods accepted; plus a verdict (correct, partially correct, incorrect, incomplete), what's right, the first error with the misconception likely behind it (and a question that tells two possible misconceptions apart), how sure it is that it read their work right, and a hint. " +
      "Use it whenever the student offers a substantive attempt — a calculation, derivation, proof, code, a multi-step solution, or an explanation to judge against key ideas — before you tell them whether it's right. Judge quick recall answers (a term, a single fact) yourself, with check_math for any math in them. " +
      "If you worked the problem out with solve_problem, pass its problem_id, so the check starts from that verified solution. If their materials might hold an answer key, worked solution, or marking scheme for the problem, find it first and pass it as `reference`. " +
      "Photos and short PDFs attached to the student's latest message are shown to the checker too. The assessment is for you, not the student.",
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
        problem_id: {
          type: "string",
          description: "Optional. The problem id solve_problem gave you for this problem.",
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
    name: CHECK_TOOL,
    description:
      "Check mathematical claims by running code (sympy) before you state them as fact. Each claim comes back verified, false (with the correct value), or couldn't check. " +
      "Use it for the math solve_problem and evaluate_answer don't cover: a value or a single calculation, a step of an explanation, a formula applied to a case, an identity, a property (this matrix is invertible, this series converges), a hint that states a result, and the answer to a quick practice question you set. " +
      "A whole problem you'll guide the student through, work as an example, or set as practice goes to solve_problem first: it also checks that the method fits the problem, which checking single claims can't. " +
      "Check the claims of a reply together in one call, before you write them; a handful takes a few seconds. " +
      "State only what comes back verified. For a false claim, use the correct value it gives. For one it couldn't check, try a clearer sympy form, or tell the student you're not sure of it.",
    input_schema: {
      type: "object",
      properties: {
        claims: {
          type: "array",
          description: "The claims to check, up to 25.",
          items: {
            type: "object",
            properties: {
              claim: {
                type: "string",
                description: 'The claim as you\'ll state it to the student, LaTeX for math, e.g. "$\\int_0^1 x^2\\,dx = \\tfrac13$".',
              },
              sympy: {
                type: "string",
                description:
                  'A self-contained sympy expression for what the claim computes, e.g. "integrate(x**2, (x, 0, 1))", or a sympy boolean for a property, e.g. "Matrix([[1, 2], [3, 4]]).det() != 0".',
              },
              value: {
                type: "string",
                description: 'What the claim says it equals, as a sympy expression, e.g. "Rational(1, 3)"; "True" for a property.',
              },
            },
            required: ["claim", "sympy", "value"],
            additionalProperties: false,
          },
        },
        assumptions: {
          type: "string",
          description:
            "Optional. What the symbols mean: domains (x real, n a positive integer), units, and definitions from the problem the claims rely on.",
        },
      },
      required: ["claims"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: SIMULATION_TOOL,
    description:
      "Show the student an interactive simulation or visualization, drawn in your reply where you call this: a free-body diagram, a vector field explorer, or a graph of functions, with sliders for the quantities that matter. " +
      "Use it when seeing or manipulating something builds understanding that words and equations alone don't: how the forces on an object and their sum change with an angle or a mass, what divergence and curl look like, how a parameter reshapes a graph. Pair it with something for the student to do: a prediction to make before they move a slider, or a question to answer from what they see. Don't use it as decoration, or where a sentence would do. " +
      "free_body_diagram draws the forces on one object from its center, to scale: on its own, on a level surface, or on an incline. The student can show each force's components along the axes and the net force, and read the sums and the acceleration. In practice mode the student draws the forces themselves and checks them against yours, which stay hidden unless they ask to see them: use it whenever the student should be the one working out the diagram, never the explore mode. " +
      "vector_field shows F(x, y) = (P, Q) as arrows; the student can pan and zoom, read F, its divergence and its curl at any point, click to trace field lines, run a flow animation, and shade divergence or curl. " +
      "function_graph plots up to six functions of one variable, with marked points; the student can pan, zoom and read values. " +
      "Expressions are strings: numbers, + - * / ^, parentheses, the simulation's own variables (x and y in a vector field; the graph's variable), parameter and constant names, pi and e, and sin cos tan asin acos atan atan2 sinh cosh tanh exp ln log log10 sqrt abs sign floor ceil round min max hypot pow, if(condition, a, b) with < <= > >=, and degree trigonometry sind cosd tand asind acosd atand (sin, cos and tan take radians). " +
      "Every name an expression uses must be a parameter (a slider) or a constant. If the input has a problem, the error says what to fix.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["free_body_diagram", "vector_field", "function_graph"] },
        title: { type: "string", description: 'A short title shown above it, e.g. "Block on a rough incline".' },
        parameters: {
          type: "array",
          description: "Up to 8 sliders. Keep ranges to what the problem needs (a mass of 1–10 kg, not 0–1000), so arrows and curves stay readable.",
          items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: 'The variable name expressions use: a letter, then letters, digits or _ (e.g. "m", "theta", "mu_k").',
            },
            label: { type: "string", description: 'Optional plain-text name shown on the slider, e.g. "Incline angle".' },
            symbol: { type: "string", description: 'Optional LaTeX symbol shown on the slider, e.g. "\\theta" or "\\mu_k". Defaults to the name.' },
            min: { type: "number" },
            max: { type: "number" },
            value: { type: "number", description: "Where the slider starts." },
            step: { type: "number", description: "Optional. Defaults to about 1/100 of the range." },
            unit: { type: "string", description: 'Optional, e.g. "kg", "°", "N", "m/s".' },
          },
          required: ["name", "min", "max", "value"],
          additionalProperties: false,
        },
        },
        constants: {
          type: "object",
          description: 'Fixed values expressions can use, e.g. {"g": 9.8, "mu_k": 0.3}.',
          additionalProperties: { type: "number" },
        },
        free_body_diagram: {
          type: "object",
          description: "For kind free_body_diagram.",
          properties: {
            mode: {
              type: "string",
              enum: ["explore", "practice"],
              description: "explore (default) shows your forces with sliders. practice has the student draw the forces and check them against yours; sliders are hidden and the forces are checked at the parameters' starting values.",
            },
            object: { type: "string", enum: ["box", "particle"], description: "Drawn as a box (default) or a round particle." },
            object_label: { type: "string", description: 'Optional LaTeX label beside the object, e.g. "m" or "m_1".' },
            surface: { type: "string", enum: ["none", "horizontal", "incline"], description: "What the object rests on. Default none." },
            incline_angle: {
              type: "string",
              description: 'For an incline: its angle above the horizontal in degrees (0–80), usually a parameter name, e.g. "theta".',
            },
            incline_rises: {
              type: "string",
              enum: ["right", "left"],
              description: "Which way the incline rises. Default right.",
            },
            forces: {
              type: "array",
              description: "Every force on the object (up to 10), drawn from its center.",
              items: {
                type: "object",
                properties: {
                  name: { type: "string", description: 'e.g. "Normal force".' },
                  type: {
                    type: "string",
                    enum: ["gravity", "normal", "friction", "tension", "applied", "spring", "drag", "buoyancy", "electric", "magnetic", "other"],
                    description: "Sets its color, and is what the student must choose in practice mode.",
                  },
                  label: { type: "string", description: 'LaTeX label at the arrow\'s tip, e.g. "F_N", "mg", "f_k".' },
                  magnitude: { type: "string", description: 'Expression, e.g. "m*g*cosd(theta)". A negative value points the opposite way.' },
                  angle: {
                    type: "string",
                    description:
                      'Direction in degrees, counterclockwise. With relative_to "horizontal" (default): 0 points right, 90 up, 180 left, -90 down. With relative_to "incline": 0 points up the slope, 90 straight out of the surface, 180 down the slope, -90 into the surface.',
                  },
                  relative_to: { type: "string", enum: ["horizontal", "incline"] },
                  angle_label: {
                    type: "string",
                    description: 'Optional LaTeX for an arc marking the angle between this force and the nearest axis, e.g. "\\theta" on the weight to show it makes angle θ with the normal axis.',
                  },
                  hint: {
                    type: "string",
                    description: "Practice mode: a nudge shown if the student misses or misdraws this force, without giving it away, e.g. \"What stops the block sliding freely?\"",
                  },
                },
                required: ["name", "type", "label", "magnitude", "angle"],
                additionalProperties: false,
              },
            },
            axes: {
              type: "string",
              enum: ["standard", "incline"],
              description: "Axes for components and sums: standard (x right, y up) or incline (y out of the surface, x along the slope). Defaults to incline on an incline.",
            },
            mass: { type: "string", description: "Optional mass expression in kg, to show the acceleration." },
            force_unit: { type: "string", description: 'Default "N".' },
            show_components: { type: "boolean", description: "Start with components shown. Default false." },
            show_net_force: { type: "boolean", description: "Start with the net force shown. Default true." },
          },
          required: ["forces"],
          additionalProperties: false,
        },
        vector_field: {
          type: "object",
          description: "For kind vector_field.",
          properties: {
            x: { type: "string", description: 'P(x, y), the x component, e.g. "-y".' },
            y: { type: "string", description: 'Q(x, y), the y component, e.g. "x".' },
            formula: { type: "string", description: 'Optional LaTeX shown under the title, e.g. "\\vec F(x,y) = \\langle -y,\\ x \\rangle".' },
            x_range: { type: "array", items: { type: "number" }, description: "[min, max] of the starting view. Default [-5, 5]; the view keeps equal scales on both axes." },
            y_range: { type: "array", items: { type: "number" }, description: "[min, max]. Default [-5, 5]." },
            flow: { type: "boolean", description: "Start the flow animation. Default false." },
            heatmap: { type: "string", enum: ["none", "divergence", "curl"], description: "Start with divergence or curl shaded. Default none." },
            trace_from: {
              type: "array",
              items: { type: "array", items: { type: "number" } },
              description: "Optional [x, y] points (up to 12) whose field lines start out drawn.",
            },
          },
          required: ["x", "y"],
          additionalProperties: false,
        },
        function_graph: {
          type: "object",
          description: "For kind function_graph.",
          properties: {
            variable: { type: "string", description: 'The independent variable. Default "x".' },
            functions: {
              type: "array",
              description: "Up to 6 functions of the variable.",
              items: {
                type: "object",
                properties: {
                  expression: { type: "string", description: 'e.g. "a*sin(b*x)".' },
                  label: { type: "string", description: 'Optional LaTeX for the legend, e.g. "f(x)" or "v(t)".' },
                },
                required: ["expression"],
                additionalProperties: false,
              },
            },
            points: {
              type: "array",
              description: "Optional marked points (up to 12); x and y are expressions in the parameters.",
              items: {
                type: "object",
                properties: { x: { type: "string" }, y: { type: "string" }, label: { type: "string", description: "Optional LaTeX." } },
                required: ["x", "y"],
                additionalProperties: false,
              },
            },
            x_range: { type: "array", items: { type: "number" }, description: "[min, max]. Default [-10, 10]." },
            y_range: { type: "array", items: { type: "number" }, description: "Optional [min, max]; fitted to the functions if left out." },
            x_label: { type: "string", description: 'Optional axis label, e.g. "t (s)".' },
            y_label: { type: "string", description: 'Optional axis label, e.g. "v (m/s)".' },
          },
          required: ["functions"],
          additionalProperties: false,
        },
      },
      required: ["kind", "title"],
      additionalProperties: false,
    },
    eager_input_streaming: true,
  },
  {
    name: PREREQUISITES_TOOL,
    description:
      "Map what a concept builds on, to find the earlier gap behind a student's trouble, even one left by another of their courses. " +
      "Returns, for you: the concept's prerequisites (and theirs, a few levels down); how likely each is to be the gap, judged from what you saw and the student's record on it (how their answers on it went in answer checks across all their courses); a quick diagnostic question for each; and where each is taught in their course materials, by course, file id and page, which you can open with open_course_material. Each map is added to the student's knowledge map, which spans their courses. " +
      "Use it when the answer check says the first error is in a prerequisite and it looks like a gap rather than a slip; when a student is stuck in a way that points to something earlier (they can't start, or the same kind of mistake keeps coming back); or before a new topic or exam review that builds on something they've found hard. Skip it for a one-off slip, or when you already know what's missing and where they learned it. " +
      "Takes about 15 to 30 seconds.",
    input_schema: {
      type: "object",
      properties: {
        concept: {
          type: "string",
          description:
            'The concept or skill to map, in textbook terms: what the student is struggling with or about to learn (e.g. "Electric flux through a surface"), or the prerequisite the answer check named, to look further into it.',
        },
        context: {
          type: "string",
          description:
            "Optional, but it sharpens the map: what you've seen — the problem, the student's error and the misconception the answer check named, or what they said they don't follow.",
        },
      },
      required: ["concept"],
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
