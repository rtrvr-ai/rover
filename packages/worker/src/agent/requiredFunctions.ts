import { PLANNER_FUNCTION_CALLS } from '@rover/shared/lib/utils/constants.js';

export enum RequiredFunctionKey {
  Act = 'actOnTab',
  Crawl = 'crawlWebPages',
  Extract = 'extractToSheets',
  PdfFiller = 'fillPdfForms',
  CreateCustomTool = 'createCustomTool',
  CreateWebPage = 'createWebPage',
  CreateGoogleDoc = 'createGoogleDoc',
  CreateGoogleSlides = 'createGoogleSlides',
}

export const requiredFunctionNames = new Set(Object.values(RequiredFunctionKey));

export const requiredFunctionNameMap: Record<RequiredFunctionKey, PLANNER_FUNCTION_CALLS> = {
  [RequiredFunctionKey.Act]: PLANNER_FUNCTION_CALLS.ACT,
  [RequiredFunctionKey.Crawl]: PLANNER_FUNCTION_CALLS.CRAWL,
  [RequiredFunctionKey.Extract]: PLANNER_FUNCTION_CALLS.EXTRACT,
  [RequiredFunctionKey.PdfFiller]: PLANNER_FUNCTION_CALLS.PDF_FILLER,
  [RequiredFunctionKey.CreateCustomTool]: PLANNER_FUNCTION_CALLS.CUSTOM_TOOL_GENERATOR,
  [RequiredFunctionKey.CreateWebPage]: PLANNER_FUNCTION_CALLS.WEBPAGE_GENERATOR,
  [RequiredFunctionKey.CreateGoogleDoc]: PLANNER_FUNCTION_CALLS.GOOGLE_DOC_GENERATOR,
  [RequiredFunctionKey.CreateGoogleSlides]: PLANNER_FUNCTION_CALLS.GOOGLE_SLIDES_GENERATOR,
};
