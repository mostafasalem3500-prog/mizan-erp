/** The JSX factory of the app: React's own, with one step added in English mode — the text is translated (see index.ts). */
import * as R from "react/jsx-runtime";
import { I18N, trProps } from "./index";
export const Fragment = R.Fragment;
export const jsx: typeof R.jsx = (type: any, props: any, key?: any) => R.jsx(type, I18N.on ? trProps(props, typeof type === "string") : props, key);
export const jsxs: typeof R.jsxs = (type: any, props: any, key?: any) => R.jsxs(type, I18N.on ? trProps(props, typeof type === "string") : props, key);
