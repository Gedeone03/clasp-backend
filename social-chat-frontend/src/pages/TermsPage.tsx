import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../LanguageContext";

export default function TermsPage() {
  const nav = useNavigate();
  const { lang } = useI18n();

  const content = useMemo(() => {
    const it = {
      title: "Termini e Condizioni d'uso",
      updated: "Ultimo aggiornamento: 19 dicembre 2025",
      sections: [
        {
          h: "1) Accettazione",
          p: [
            "Clasp è un servizio di comunicazione e social chat. Utilizzando Clasp, accetti i presenti Termini e l’Informativa Privacy.",
            "Se non accetti, non utilizzare l’app o il sito.",
          ],
        },
        {
          h: "2) Account e sicurezza",
          p: [
            "Sei responsabile delle credenziali e di tutte le attività svolte con il tuo account.",
            "Non condividere password e non usare account di terzi senza autorizzazione.",
          ],
        },
        {
          h: "3) Contenuti e comportamento",
          p: [
            "Sei responsabile dei contenuti che invii (messaggi, immagini, file, audio, ecc.).",
            "È vietato pubblicare contenuti illegali, minacciosi, violenti, discriminatori, diffamatori, o che violino diritti di terzi.",
            "È vietato spam, stalking, molestie, e tentativi di elusione delle misure di sicurezza.",
          ],
        },
        {
          h: "4) Moderazione e segnalazioni",
          p: [
            "Possiamo limitare o rimuovere contenuti o account in caso di violazioni, anche senza preavviso quando necessario.",
            "Puoi segnalare abusi tramite i canali di supporto indicati nell’app.",
          ],
        },
        {
          h: "5) Disponibilità del servizio",
          p: [
            "Il servizio può subire interruzioni, manutenzioni o modifiche.",
            "Non garantiamo disponibilità continua o assenza di errori.",
          ],
        },
        {
          h: "6) Limitazione di responsabilità",
          p: [
            "Clasp è fornito “così com’è”. Nella misura massima consentita dalla legge, non siamo responsabili per danni indiretti o perdite derivanti dall’uso del servizio.",
          ],
        },
        {
          h: "7) Chiusura account",
          p: [
            "Puoi interrompere l’uso del servizio in qualsiasi momento.",
            "Possiamo sospendere/chiudere account che violano i Termini o per motivi di sicurezza.",
          ],
        },
        {
          h: "8) Modifiche",
          p: [
            "Possiamo aggiornare i Termini. Le modifiche saranno comunicate tramite app/sito quando appropriato.",
          ],
        },
        {
          h: "9) Contatti",
          p: ["Per richieste su Termini o Privacy, usa i riferimenti presenti nell’app o sul sito."],
        },
      ],
    };

    const en = {
      title: "Terms and Conditions",
      updated: "Last updated: December 19, 2025",
      sections: [
        {
          h: "1) Acceptance",
          p: [
            "Clasp is a communication and social chat service. By using Clasp you accept these Terms and the Privacy Policy.",
            "If you do not accept, do not use the app or website.",
          ],
        },
        {
          h: "2) Account and security",
          p: [
            "You are responsible for your credentials and all activity on your account.",
            "Do not share passwords and do not use third-party accounts without authorization.",
          ],
        },
        {
          h: "3) Content and conduct",
          p: [
            "You are responsible for content you send (messages, images, files, audio, etc.).",
            "Illegal, threatening, violent, discriminatory, defamatory content, or content that violates third-party rights is prohibited.",
            "Spam, stalking, harassment and attempts to bypass security measures are prohibited.",
          ],
        },
        {
          h: "4) Moderation and reporting",
          p: [
            "We may restrict or remove content/accounts in case of violations, including without notice when necessary.",
            "You can report abuse through the support channels provided in the app.",
          ],
        },
        {
          h: "5) Service availability",
          p: [
            "The service may experience interruptions, maintenance or changes.",
            "We do not guarantee continuous availability or error-free operation.",
          ],
        },
        {
          h: "6) Limitation of liability",
          p: ["Clasp is provided “as is”. To the maximum extent permitted by law, we are not liable for indirect damages or losses arising from use of the service."],
        },
        {
          h: "7) Account termination",
          p: [
            "You may stop using the service at any time.",
            "We may suspend/terminate accounts that violate these Terms or for security reasons.",
          ],
        },
        {
          h: "8) Changes",
          p: ["We may update these Terms. Changes will be communicated through the app/website when appropriate."],
        },
        { h: "9) Contact", p: ["For requests about Terms or Privacy, use the contact details available in the app/website."] },
      ],
    };

    return lang === "en" ? en : it;
  }, [lang]);

  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--tiko-bg-dark)", overflowY: "auto", zIndex: 9999 }}>
      <div style={{ padding: 14, maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
          <button
            type="button"
            onClick={() => nav(-1)}
            style={{
              padding: "8px 10px",
              borderRadius: 12,
              border: "1px solid #2a2a2a",
              background: "transparent",
              cursor: "pointer",
              fontWeight: 950,
            }}
          >
            ←
          </button>
        </div>

        <div style={{ background: "var(--tiko-bg-card)", border: "1px solid #222", borderRadius: 14, padding: 14 }}>
          <h2 style={{ marginTop: 0 }}>{content.title}</h2>

          {content.sections.map((s) => (
            <div key={s.h} style={{ marginBottom: 14 }}>
              <h3 style={{ margin: "10px 0 6px" }}>{s.h}</h3>
              {s.p.map((p, idx) => (
                <p key={idx} style={{ margin: "6px 0", color: "var(--tiko-text-dim)", lineHeight: 1.5 }}>
                  {p}
                </p>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
