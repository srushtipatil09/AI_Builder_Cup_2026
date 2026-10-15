import { useEffect } from "react";
import { Link } from "react-router-dom";
import { usePhoneEntry } from "../phoneEntry";
import { SiteFrame } from "./SiteFrame";

type Props = {
  eyebrow: string;
  title: string;
  lede: string;
  children: React.ReactNode;
  aside: React.ReactNode;
};

const TEAL = "#0c4f49";

// Tint the phone status bar to match the screen behind it, then put it back.
function useStatusBarColor(color: string, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) return;
    const previous = meta.content;
    meta.content = color;
    return () => {
      meta.content = previous;
    };
  }, [color, active]);
}

export function AuthLayout({ eyebrow, title, lede, children, aside }: Props) {
  const phone = usePhoneEntry();
  useStatusBarColor(TEAL, phone);

  if (phone) {
    return (
      <div className="m-auth">
        <header className="m-auth-top">
          <img src="/icons/icon-192.png" width="192" height="192" alt="" />
          <p className="m-auth-brand" lang="hi">
            साथी
          </p>
          <p className="m-auth-tag">A Hindi companion that speaks first.</p>
        </header>
        <main id="main" className="m-auth-sheet" aria-labelledby="auth-title">
          <h1 id="auth-title">{title}</h1>
          <p className="auth-lede">{lede}</p>
          {children}
          <p className="m-auth-demo">
            <Link to="/app?demo=1">Try the Kamla Sharma demo</Link>
            <span>No account form. The household is synthetic.</span>
          </p>
        </main>
      </div>
    );
  }

  return (
    <SiteFrame>
      <div className="auth">
        <section className="auth-card" aria-labelledby="auth-title">
          <p className="eyebrow">{eyebrow}</p>
          <h1 id="auth-title">{title}</h1>
          <p className="auth-lede">{lede}</p>
          {children}
        </section>
        <aside className="auth-aside">
          {aside}
          <div className="auth-demo">
            <p>
              <strong>Just looking?</strong> The Kamla Sharma demo needs no account form. The household is synthetic.
            </p>
            <Link className="button button-light" to="/app?demo=1">
              Try the demo
            </Link>
          </div>
        </aside>
      </div>
    </SiteFrame>
  );
}
