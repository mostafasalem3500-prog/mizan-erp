/** Tiny shared pieces of the charity interface, kept apart so the core program does not bundle the whole interface. */
import { createContext, useContext } from "react";
export const ChCtx = createContext<{ settings: any; reload: () => void; projects: any[]; reloadProjects: () => void }>({ settings: null, reload: () => undefined, projects: [], reloadProjects: () => undefined });
export const useCharity = () => useContext(ChCtx);
export const DEFAULT_NAME = "جمعية ريادة العطاء لخدمة الإنسان بالعسيلة";
export const DEFAULT_LOGO = "/charity/logo.png";
export const DEFAULT_LICENSE = "1000888600";
