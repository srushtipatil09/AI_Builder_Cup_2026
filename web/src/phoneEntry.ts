import { useEffect, useState } from "react";

type IosNavigator = Navigator & { standalone?: boolean };

export function isPhoneEntry(): boolean {
  const standalone =
    (navigator as IosNavigator).standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches;
  const phone = window.matchMedia("(max-width: 767px)").matches;
  const coarsePhone = window.matchMedia("(pointer: coarse) and (max-width: 1023px)").matches;
  return standalone || phone || coarsePhone;
}

export function usePhoneEntry(): boolean {
  const [phone, setPhone] = useState(isPhoneEntry);

  useEffect(() => {
    const queries = [
      window.matchMedia("(max-width: 767px)"),
      window.matchMedia("(pointer: coarse) and (max-width: 1023px)"),
      window.matchMedia("(display-mode: standalone)"),
      window.matchMedia("(display-mode: fullscreen)"),
      window.matchMedia("(display-mode: minimal-ui)"),
    ];
    const update = () => setPhone(isPhoneEntry());
    queries.forEach((query) => query.addEventListener("change", update));
    return () => queries.forEach((query) => query.removeEventListener("change", update));
  }, []);

  return phone;
}
