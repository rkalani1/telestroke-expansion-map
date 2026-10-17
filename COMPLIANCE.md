# Compliance and Data Boundary

Public-use boundary: Public reference map only. Current public branch must not contain internal partner status, strategy annotations, contracting, dispatch, or operational planning data.

This repository is not an official clinical, educational, institutional, staffing, finance, recruitment, or operational system. Public deployments are for synthetic, educational, or public-reference use only.

Do not commit, upload, paste, or test with:

- PHI, patient identifiers, or real clinical details;
- research participant identifiers or restricted research data;
- learner, trainee, assessor, personnel, staffing, finance, contract, or credentialing records;
- confidential/restricted operational, strategic, partner, or contract information;
- credentials, tokens, keys, secrets, screenshots of private systems, or exported source documents.

Allowed public content:

- synthetic examples clearly labeled as synthetic;
- public-domain or properly cited public reference material;
- aggregate methods examples that cannot identify people, sites, partners, contracts, or internal operations.

Deployment rule: real clinical, patient-facing, trainee-record, research-participant, or internal-planning use must move to an approved controlled environment with access control, approved storage, security review, incident-response path, and owner governance.

Browser storage and links: the app keeps only display preferences in `localStorage` (theme, colour-vision palette, basemap, legend state, keyboard-shortcut setting, and the id of the user's chosen "my receiving center", a public hospital record). It stores no notes, patient or operational data, and browser storage is not access control. Share links carry the same public view state and nothing else.

Review cadence: review before every public Pages deployment and after any change that adds forms, uploads, local storage, exports, contact workflows, clinical recommendations, study recruitment language, or organizational branding.
