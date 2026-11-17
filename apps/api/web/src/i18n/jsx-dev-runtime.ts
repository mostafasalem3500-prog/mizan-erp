import * as R from "react/jsx-dev-runtime";
import { I18N, trProps } from "./index";
export const Fragment = R.Fragment;
export const jsxDEV: typeof R.jsxDEV = (type: any, props: any, ...rest: any[]) => (R.jsxDEV as any)(type, I18N.on ? trProps(props, typeof type === "string") : props, ...rest);
