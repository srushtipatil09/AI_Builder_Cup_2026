import { createContext, useContext } from "react";

// Call before a delete. The care desk keeps the desk as it was, and shows "Deleted · Undo" for a few seconds.
export const UndoContext = createContext<(label: string) => void>(() => {});

export function useUndoable() {
  return useContext(UndoContext);
}
