import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { usePhoneEntry } from "../phoneEntry";
import { clearSession, readSession } from "../session";

type Props = {
  children: React.ReactNode;
  home?: boolean;
};

export function SiteFrame({ children, home = false }: Props) {
  const { pathname } = useLocation();
  const phone = usePhoneEntry();
  const [session, setSession] = useState(readSession);

  function logOut() {
    clearSession();
    setSession(null);
  }

  return (
    <div className={home ? "site site-home" : "site"}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="site-bar">
          <Link className="brand" to="/" lang="hi">
            साथी
          </Link>
          <nav className="site-nav" aria-label="Primary">
            {phone ? null : pathname === "/" ? (
              <a href="#day">A day with Saathi</a>
            ) : (
              <Link to="/#day">A day with Saathi</Link>
            )}
            <Link className="nav-demo" to="/app?demo=1">
              Kamla Sharma demo
            </Link>
            {session ? (
              <>
                <Link to="/app">Open chat</Link>
                <button className="nav-button" type="button" onClick={logOut}>
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link to="/login" aria-current={pathname === "/login" ? "page" : undefined}>
                  Log in
                </Link>
                <Link
                  className={pathname === "/signup" ? undefined : "button"}
                  to="/signup"
                  aria-current={pathname === "/signup" ? "page" : undefined}
                >
                  Create account
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>
      <main id="main" className={home ? "site-main site-main-home" : "site-main"}>
        {children}
      </main>
      <footer className="site-footer">
        <div className="site-foot">
          <div className="foot-about">
            <p className="footer-name" lang="hi">
              साथी
            </p>
            <p>A Hindi companion that starts the conversation for a parent whose family lives somewhere else.</p>
          </div>
          <nav aria-label="Footer">
            <p className="foot-head">Get started</p>
            <Link to="/login">Log in</Link>
            <Link to="/signup">Create account</Link>
            <Link to="/app?demo=1">Kamla Sharma demo</Link>
          </nav>
          <div>
            <p className="foot-head">Good to know</p>
            <ul>
              <li>A closed app does not listen.</li>
              <li>Chrome on a phone can install Saathi. On iPhone, use Share, then Add to Home Screen.</li>
              <li>A speaker in the room is later work.</li>
            </ul>
          </div>
        </div>
        <p className="foot-base">The demo household is synthetic, and its data is labeled.</p>
      </footer>
    </div>
  );
}
