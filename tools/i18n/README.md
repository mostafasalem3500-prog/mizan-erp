# English interface — dictionary tools

The screens are written in Arabic. In English mode (the «English» button in the top bar, or `?lang=en`) every text on
its way to the page is looked up in `apps/api/web/src/i18n/en.json` by the app's JSX factory
(`apps/api/web/src/i18n/jsx-runtime.ts`), the page switches to `dir="ltr"`, and dates and numbers use an English
locale. Text that is not in the dictionary — names, descriptions and anything else people typed — stays as it is.

What stays Arabic on purpose:

- printed documents (`InvoicePaper.tsx` uses React's own JSX factory): a tax invoice must carry Arabic; the print
  template's «English» option adds English beside it;
- the associations edition (`/charity`);
- the smart assistant's answers and the language it understands;
- the public developer page `/developers`.

## Adding a screen or a message

1. Write the screen in Arabic as usual.
2. `node tools/i18n/check.cjs --todo /tmp/todo.tsv` lists the new texts that have no English and writes them to a file.
3. Fill the third column of the file (keep `${0}` → `{0}` placeholders, `**bold**` markers and the order of `←`
   path arrows as `→`), then `node tools/i18n/add.cjs /tmp/todo.tsv`.

CI runs `check.cjs` and fails when more than 40 interface texts have no English (`I18N_MAX_MISSING`).

## How a text is looked up

The whole text; the text without its outer punctuation (`«…»`, `:`, `**`); a sentence with variable parts
(`تم حفظ ${0} صنف` → `{0} items saved`); the text without a code or number before or after it (`5203 رواتب وأجور`);
then each Arabic run on its own. A pattern whose values are Arabic data (a customer's name) is used only when its fixed
words are a real part of the sentence, so a short pattern cannot claim unrelated text. `norm.cjs` holds the
normalisation shared with the app — keep the two in step.
