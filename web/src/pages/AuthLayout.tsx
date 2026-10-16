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
  // The demo links suit a visitor, not someone already signed in.
  demoLinks?: boolean;
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

export function AuthLayout({ eyebrow, title, lede, children, aside, demoLinks = true }: Props) {
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
          {demoLinks ? (
            <div className="m-auth-demo">
              <p>Try a demo. No account form; the household is synthetic.</p>
              <div className="m-auth-demo-links">
                <Link to="/app?demo=1">Kamla&rsquo;s phone</Link>
                <Link to="/care?demo=1">Caretaker app</Link>
              </div>
            </div>
          ) : null}
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
          {demoLinks ? (
            <div className="auth-demo">
              <p>
                <strong>Just looking?</strong> Neither demo needs an account form. The household is synthetic.
              </p>
              <div className="auth-demo-links">
                <Link className="button button-light" to="/app?demo=1">
                  Kamla&rsquo;s phone
                </Link>
                <Link className="button button-light" to="/care?demo=1">
                  Caretaker app
                </Link>
              </div>
            </div>
          ) : null}
        </aside>
      </div>
    </SiteFrame>
  );
}
