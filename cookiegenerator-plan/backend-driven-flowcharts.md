# Backend-Driven Flowcharts (per feature)

Process flowcharts for each backend-driven flow, in the classic notation:

- **Green stadium** = START / END (terminator)
- **Yellow rectangle** = process step (server does work)
- **Yellow parallelogram** = input / output (request in, response out)
- **Blue diamond** = decision, with **YES / NO** branches

Each flow names **what the backend owns** (the source of truth). Companion to
`rfc-backend-driven-architecture.md`.

---

## 1. Render the cookie policy (export / email HTML)

The server owns the whole render: ownership, content load, **migration of old rows**, rendering
**each field by its type**, and rewriting image refs to public URLs. The client never composes HTML.

```mermaid
flowchart TD
  S([START]) --> R[/"Receive request: websiteId"/]
  R --> A["Assert website owned by user"]
  A --> D1{"Owned?"}
  D1 -->|NO| E404[/"Return 404 not found"/] --> Z([END])
  D1 -->|YES| L["Load cookie_policy.content (jsonb)"]
  L --> M["migrateContent(): fill fields missing in old rows"]
  M --> RF["Render each section's fields BY TYPE<br/>(text, richtext, checkbox, date)"]
  RF --> IMG["Rewrite /pulse/images/:id → PUBLIC_BASE_URL/pulse/public/images/:id"]
  IMG --> OUT[/"Return self-contained HTML snippet"/]
  OUT --> Z

  classDef term fill:#b7e1cd,stroke:#3f8f6b,color:#0f2a1e;
  classDef proc fill:#fdf3b4,stroke:#caa93f,color:#3a3413;
  classDef io   fill:#fdf3b4,stroke:#caa93f,color:#3a3413;
  classDef dec  fill:#bcd6f7,stroke:#5f8fd6,color:#122744;
  class S,Z term
  class A,L,M,RF,IMG proc
  class R,OUT,E404 io
  class D1 dec
```

---

## 2. Load the editor (server-driven schema + content + state)

The server returns the **schema** (which sections/fields exist, their types/labels/order), the
**content**, and the **computed state** (`canGenerate`, completed, progress). The client just renders.

```mermaid
flowchart TD
  S([START]) --> R[/"Receive GET /cookie-policy"/]
  R --> A["Assert website owned by user"]
  A --> D1{"Owned?"}
  D1 -->|NO| E404[/"Return 404"/] --> Z([END])
  D1 -->|YES| L["Load content (jsonb)"]
  L --> M["migrateContent() → current shape"]
  M --> SC["Build SECTION schema (fields + types + order + labels)"]
  SC --> ST["Compute state: canGenerate, completed[], progress"]
  ST --> OUT[/"Return { schema, content, state }"/]
  OUT --> Z

  classDef term fill:#b7e1cd,stroke:#3f8f6b,color:#0f2a1e;
  classDef proc fill:#fdf3b4,stroke:#caa93f,color:#3a3413;
  classDef io   fill:#fdf3b4,stroke:#caa93f,color:#3a3413;
  classDef dec  fill:#bcd6f7,stroke:#5f8fd6,color:#122744;
  class S,Z term
  class A,L,M,SC,ST proc
  class R,OUT,E404 io
  class D1 dec
```

---

## 3. Auth token check with TYPED error codes

The server classifies the outcome and returns a **stable code** (`TOKEN_EXPIRED` /
`TOKEN_USED` / `TOKEN_INVALID` / `OK`). The client routes on the **code**, never on message text.

```mermaid
flowchart TD
  S([START]) --> R[/"Receive token (verify / reset)"/]
  R --> F["Look up token in DB"]
  F --> D1{"Token exists?"}
  D1 -->|NO| C1[/"Return 403 code: TOKEN_INVALID"/] --> Z([END])
  D1 -->|YES| D2{"Already used?"}
  D2 -->|YES| C2[/"Return 401 code: TOKEN_USED"/] --> Z
  D2 -->|NO| D3{"Expired?"}
  D3 -->|YES| C3[/"Return 401 code: TOKEN_EXPIRED"/] --> Z
  D3 -->|NO| OK["Consume token / complete action"]
  OK --> C4[/"Return 200 code: OK"/] --> Z

  classDef term fill:#b7e1cd,stroke:#3f8f6b,color:#0f2a1e;
  classDef proc fill:#fdf3b4,stroke:#caa93f,color:#3a3413;
  classDef io   fill:#fdf3b4,stroke:#caa93f,color:#3a3413;
  classDef dec  fill:#bcd6f7,stroke:#5f8fd6,color:#122744;
  class S,Z term
  class F,OK proc
  class R,C1,C2,C3,C4 io
  class D1,D2,D3 dec
```

---

## 4. Send policy code to a teammate

Server builds the same HTML (public image URLs → small snippet), inlines it in the email, and
sends it; mail-transport errors are **swallowed** so the request still succeeds.

```mermaid
flowchart TD
  S([START]) --> R[/"Receive { email }"/]
  R --> A["Assert website owned by user"]
  A --> D1{"Owned?"}
  D1 -->|NO| E404[/"Return 404"/] --> Z([END])
  D1 -->|YES| B["buildPolicyHtml() (public image URLs)"]
  B --> C["Compose email: snippet inline in <pre>"]
  C --> M["sendEmail() via nodemailer"]
  M --> D2{"Transport error?"}
  D2 -->|YES| LOG["Log error (swallow)"]
  D2 -->|NO| OKp["Sent"]
  LOG --> OUT[/"Return 200"/]
  OKp --> OUT
  OUT --> Z

  classDef term fill:#b7e1cd,stroke:#3f8f6b,color:#0f2a1e;
  classDef proc fill:#fdf3b4,stroke:#caa93f,color:#3a3413;
  classDef io   fill:#fdf3b4,stroke:#caa93f,color:#3a3413;
  classDef dec  fill:#bcd6f7,stroke:#5f8fd6,color:#122744;
  class S,Z term
  class A,B,C,M,LOG,OKp proc
  class R,OUT,E404 io
  class D1,D2 dec
```

---

## 5. Serve a public policy image (bytes from private S3)

The public route streams bytes from the **still-private** S3 bucket (read server-side). No auth,
no ownership — cookie-policy images are public-by-intent.

```mermaid
flowchart TD
  S([START]) --> R[/"Receive GET /pulse/public/images/:id"/]
  R --> D1{"Valid UUID?"}
  D1 -->|NO| E1[/"Return 404"/] --> Z([END])
  D1 -->|YES| F["findKeyById(id) — no owner join"]
  F --> D2{"Row found?"}
  D2 -->|NO| E2[/"Return 404"/] --> Z
  D2 -->|YES| G["getObjectBuffer(key) from private S3"]
  G --> D3{"Object readable?"}
  D3 -->|NO| E3[/"Return 404"/] --> Z
  D3 -->|YES| OUT[/"Stream bytes (Cache-Control: public)"/]
  OUT --> Z

  classDef term fill:#b7e1cd,stroke:#3f8f6b,color:#0f2a1e;
  classDef proc fill:#fdf3b4,stroke:#caa93f,color:#3a3413;
  classDef io   fill:#fdf3b4,stroke:#caa93f,color:#3a3413;
  classDef dec  fill:#bcd6f7,stroke:#5f8fd6,color:#122744;
  class S,Z term
  class F,G proc
  class R,OUT,E1,E2,E3 io
  class D1,D2,D3 dec
```
