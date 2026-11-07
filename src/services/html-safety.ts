import DOMPurify from 'dompurify'

// Raw Markdown is cleaned before formula expansion. Only the final KaTeX
// result can retain inline styles; trust:false prevents user-supplied HTML.
export function sanitizeHTML(html:string, formulaOutput=false):string {
  return DOMPurify.sanitize(String(html), {
    USE_PROFILES: { html: true, mathMl: true, svg: true },
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed'],
    FORBID_ATTR: formulaOutput ? [] : ['style'],
    ALLOW_DATA_ATTR: false,
  })
}
window.App=window.App||{}
window.App.safeHTML=sanitizeHTML
