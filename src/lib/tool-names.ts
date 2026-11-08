/**
 * Names of Ainsley's own tools, shared by /api/chat (which declares them) and the browser (which
 * runs them: the course library and knowledge map live there, and it calls /api/solve,
 * /api/evaluate, /api/prerequisites and /api/check).
 */
export const SEARCH_TOOL = "search_course_materials";
export const OPEN_TOOL = "open_course_material";
export const MODULE_TOOL = "get_course_module";
export const SOLVE_TOOL = "solve_problem";
export const EVALUATE_TOOL = "evaluate_answer";
export const SIMULATION_TOOL = "show_simulation";
export const PREREQUISITES_TOOL = "trace_prerequisites";
export const CHECK_TOOL = "check_math";
