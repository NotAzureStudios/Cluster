// Masked fields that are not login passwords (PINs, tokens, keys, other
// people's passwords). type="password" makes every browser offer to save a
// login, so these are text inputs drawn as dots, opted out of password managers.
export const SECRET_INPUT_PROPS = {
  type: "text",
  autoComplete: "off",
  spellCheck: false,
  "data-secret": "true",
  "data-1p-ignore": "true",
  "data-lpignore": "true",
  "data-bwignore": "true",
  "data-form-type": "other",
} as const;
