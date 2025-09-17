Obiettivo
Costruire una webapp modulare, leggera e hostabile gratuitamente che fornisca liste e note condivise in REALTIME tra utenti in whitelist. La sincronizzazione in tempo reale è il requisito principale: ogni modifica fatta da un client deve propagarsi agli altri client autorizzati (desktop e mobile) e rimanere persistente fino a cancellazione.

Vincoli obbligatori
1. Usare GitHub Pages come prima opzione di hosting statico. Documentare passo passo come fare il deploy su GitHub Pages con GitHub Actions. 
2. Usare Supabase Realtime come servizio realtime e persistenza principale. Documentare come creare il progetto Supabase, dove mettere le chiavi e come collegare la webapp. Se Supabase non è possibile offrire un’alternativa gratuita equivalente con pro/contro.
3. Non commettere mai credenziali reali nel repo. Fornire config.example.json con placeholders e spiegare come impostare i segreti nel repository GitHub Secrets.
4. Progettare il codice in moduli piccoli e chiari con questi file obbligatori: auth.js, sync.js, checklist.js, notes.js, ui.js, backgrounds.js, logger.js, config.example.json, index.html, main.css. Ogni modulo deve avere responsabilità unica e una breve docstring all’inizio.

Autenticazione e whitelist
1. Pagina login con campi username e password e pulsante Login.
2. L’utente fornirà le coppie username/password che vanno inserite nella whitelist. La whitelist deve essere gestita in configurazione sicura e non in chiaro nel repo.
3. Solo le coppie presenti nella whitelist possono accedere. Utenti non autorizzati vedono messaggio “Accesso negato”.
4. Implementare logout visibile.
5. Documentare come creare un GitHub Personal Access Token con i permessi minimi necessari per il deploy automatico e come l’utente lo inserisce in GitHub Secrets. Se l’LLM necessita di un token per deploy e test, richiedere esplicitamente il token al proprietario e usarlo solo via GitHub Actions con secrets.

Tipi di documento e definizioni precise
1. Note: editor = area di testo multilinea con titolo e pulsanti Salva, Elimina, Rinomina.
2. Checklist: campo input + pulsante Aggiungi. Ogni voce ha checkbox, testo, pulsante X per eliminare. Le voci spuntate restano visibili e barrate.

Interfaccia checklist esatta
1. Due colonne affiancate:
   - Sinistra: "Da comprare" con tema cromatico predominante rosso.
   - Destra: "Comprato / in Frigo" con tema cromatico predominante viola.
2. In cima a ogni colonna un singolo pulsante: "Sposta nell'altra colonna". Quando premuto, sposta tutte le voci selezionate della colonna corrente nella colonna opposta.
3. Rimuovere il drag&drop. Non implementare handle a 6 puntini.
4. Funzione elimina singola voce con pulsante X su ogni voce.
5. Aggiunta voci: la voce compare nella colonna "Da comprare" per default.
6. Le voci spuntate restano visibili e barrate, non vengono cancellate automaticamente.
7. Lista fissa e incancellabile in alto chiamata "Lista dela spessa" con voci iniziali pane, manzo, cheddar. Questa checklist rimane sempre visibile e non cancellabile dall’interfaccia.

Sincronizzazione e persistenza obbligatorie
1. Ogni azione CRUD e ogni cambio di stato (create, edit, check, uncheck, move, delete) deve essere salvata in storage persistente e replicata in realtime a tutti i client autorizzati.
2. L’LLM sceglie la soluzione tecnica ma deve motivarla, documentarla e fornire istruzioni di deploy gratuite.
3. Fornire test documentati che provino la sincronizzazione tra almeno tre scenari: desktop verso mobile, mobile verso desktop e mobile verso mobile. Per ogni test indicare i passaggi e il tempo di latenza misurato.

Backgrounds e effetti
1. Non inserire background hardcoded. Creare un modulo backgrounds.js che carica snippet esterni posizionati nella cartella backgrounds.
2. Documentare come importare ed attivare gli snippet che fornirò da reactbits.dev o altre fonti.

Logger e gestione errori prioritaria
1. Implementare logger.js che registra eventi con timestamp, user-id, azione e dettagli.
2. Logger deve raccogliere errori tecnici e stack trace quando disponibili.
3. UI: pulsante "Log" che apre pannello con registro leggibile, ricercabile e copiabile/exportable.
4. L’LLM deve controllare i log e la console dopo ogni task e includere i risultati dei controlli nel report.

UI richiesta e stile
1. Login page: in alto un testo scorrevole da destra verso sinistra con la scritta ROXSTAR RIZOZZE GESTIANALI in giallo bold maiuscolo.
2. Footer in tutte le pagine: scritta animata COOKED BY FRED CAMPZILLA con effetto glowing ciclico verde, nero, giallo, nero, rosso, nero in loop.
3. Tools page titolo in alto STURMENTI E RIZOZZE GESTIANALI ROXSTAR.
4. Palette: verde prato per dettagli e bottoni, rosso per colonna Da comprare, viola per colonna Comprato / in Frigo.
5. La cartella backgrounds conterrà gli snippet che fornirò e il codice deve permettere di attivarli/disattivarli facilmente.

Sicurezza e segreti
1. Non commettere segreti né credenziali nel repository.
2. Fornire istruzioni chiare per impostare GitHub Secrets per: Supabase URL, Supabase anon key, eventuali chiavi per servizi esterni e per GitHub Actions.
3. Indicare il minimo scope del Personal Access Token necessario per deploy via GitHub Actions e come l’utente può revocarlo dopo i test.

Testing obbligatorio prima della consegna
1. Autenticazione: dimostrare che utenti non whitelist non accedono.
2. Sincronizzazione: eseguire almeno 3 test con misurazione della latenza e includere screenshot o log.
3. Logger: dimostrare che log degli eventi sono registrati e esportabili.
4. Fornire un breve report test con i risultati.

Documentazione finale richiesta
1. README chiaro con passaggi passo passo per deploy su GitHub Pages e configurazione Supabase Realtime.
2. config.example.json con struttura e placeholders.
3. Istruzioni su come inserire la whitelist in modo sicuro.
4. Istruzioni su come attivare gli snippet di background dalla cartella backgrounds.
5. Come raccogliere ed esportare i log per debug.

Consegna attesa
1. Progetto modulare completo pronto per deploy su GitHub Pages con Supabase Realtime collegato.
2. README e config.example.json.
3. Report breve dei test eseguiti e risultati.
4. Nessuna credenziale reale nel repository.

Nota finale per l’LLM che lavora sul progetto
1. Documenta ogni scelta tecnica e i trade-off. 
2. Dopo ogni task eseguito esegui controlli sul terminale e sui log, registra i risultati e correggi eventuali regressioni prima di procedere. 
3. Se hai bisogno del Personal Access Token per deployare e testare online, richiedilo esplicitamente al proprietario e fornisci istruzioni esatte per limitarne il scope e per inserirlo in GitHub Secrets.

ricontrolla sempre. verifica. ottieni prove. non dare mai per scontato nulla, mai. usa le tasklist per organizzarti e non dimenticare nulla.
questo sito deve essere perfetto

io sono il direttore e tu sei il programmatore esperto e professionista. non delegarmi mai lavori che puoi fare tu. io testerò l'app quando è conclusa e perfetta.
