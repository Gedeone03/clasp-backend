import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../LanguageContext";

export default function PrivacyPage() {
  const nav = useNavigate();
  const { lang } = useI18n();

  const content = useMemo(() => {
    const it = {
      title: "Informativa Privacy",
      updated: "Ultimo aggiornamento: 19 dicembre 2025",
      sections: [
        {
          h: "1) Dati trattati",
          p: [
            "Dati account: email, username, password (in forma cifrata/hash).",
            "Dati profilo: nome visualizzato, stato, mood, città/zona, immagine profilo, testi di status.",
            "Contenuti: messaggi e media inviati (immagini/file) necessari a fornire il servizio.",
            "Dati tecnici: log di sicurezza, indirizzo IP, informazioni minime di funzionamento e prevenzione abusi.",
          ],
        },
        {
          h: "2) Finalità",
          p: [
            "Erogare il servizio di chat, amicizie e funzionalità social.",
            "Sicurezza, prevenzione abusi/spam, miglioramento dell’esperienza utente.",
            "Adempimenti legali e gestione di richieste/assistenza.",
          ],
        },
        {
          h: "3) Base giuridica",
          p: [
            "Esecuzione del servizio richiesto (contratto/fornitura del servizio).",
            "Legittimo interesse alla sicurezza e prevenzione abusi.",
            "Obblighi di legge quando applicabili.",
          ],
        },
        {
          h: "4) Conservazione",
          p: [
            "I dati sono conservati per il tempo necessario a fornire il servizio e per obblighi legali o tutela di sicurezza.",
            "Puoi richiedere la cancellazione dell’account secondo le modalità disponibili nell’app/sito.",
          ],
        },
        {
          h: "5) Condivisione",
          p: [
            "I dati possono essere trattati da fornitori tecnici (hosting, database, storage) esclusivamente per fornire il servizio.",
            "Non vendiamo i tuoi dati personali.",
          ],
        },
        {
          h: "6) Sicurezza",
          p: [
            "Adottiamo misure tecniche e organizzative ragionevoli per proteggere dati e account (es. password cifrate/hash, controlli accessi).",
            "Nessun sistema è infallibile: ti invitiamo a usare password robuste e non condividerle.",
          ],
        },
        {
          h: "7) Diritti",
          p: [
            "Puoi richiedere accesso, rettifica, cancellazione, limitazione e portabilità nei limiti previsti dalla legge.",
            "Per richieste privacy usa i contatti presenti nell’app/sito.",
          ],
        },
        {
          h: "8) Minori",
          p: ["Il servizio non è destinato a minori secondo le normative applicabili. Se ritieni che un minore stia usando il servizio, contattaci."],
        },
        {
          h: "9) Modifiche",
          p: ["Possiamo aggiornare questa informativa. Le modifiche rilevanti saranno comunicate tramite app/sito quando appropriato."],
        },
      ],
    };

    const en = {
      title: "Privacy Policy",
      updated: "Last updated: December 19, 2025",
      sections: [
        {
          h: "1) Data we process",
          p: [
            "Account data: email, username, password (stored as hashed/encrypted).",
            "Profile data: display name, status, mood, city/area, profile picture, status text.",
            "Content: messages and media you send (images/files) required to provide the service.",
            "Technical data: security logs, IP address, minimal operational data to prevent abuse.",
          ],
        },
        {
          h: "2) Purposes",
          p: [
            "Provide the chat, friends and social features.",
            "Security, anti-abuse/spam prevention and improving user experience.",
            "Legal compliance and support handling.",
          ],
        },
        {
          h: "3) Legal basis",
          p: [
            "Performance of the requested service.",
            "Legitimate interest in security and abuse prevention.",
            "Legal obligations when applicable.",
          ],
        },
        {
          h: "4) Retention",
          p: [
            "Data is retained as long as needed to provide the service and for legal/security requirements.",
            "You can request account deletion according to the options available in the app/website.",
          ],
        },
        {
          h: "5) Sharing",
          p: [
            "Data may be processed by technical providers (hosting, database, storage) only to deliver the service.",
            "We do not sell your personal data.",
          ],
        },
        {
          h: "6) Security",
          p: [
            "We use reasonable technical and organizational measures to protect data and accounts (e.g., hashed passwords, access controls).",
            "No system is perfect: use strong passwords and never share them.",
          ],
        },
        {
          h: "7) Your rights",
          p: [
            "You may request access, rectification, deletion, restriction and portability as provided by law.",
            "For privacy requests, use the contact details in the app/website.",
          ],
        },
        { h: "8) Children", p: ["The service is not intended for children under applicable laws. If you believe a child is using the service, contact us."] },
        { h: "9) Changes", p: ["We may update this policy. Material changes will be communicated through the app/website when appropriate."] },
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
