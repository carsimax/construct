# Cruce de piezas: las mejores ideas de cada metodología, combinadas sobre ODD

Base: [Metodologías de desarrollo con agentes IA](Metodologías%20de%20desarrollo%20con%20agentes%20IA.md) y sus notas en `../notes/`. Este documento es una **propuesta de diseño**, no investigación nueva: cada pieza cita su origen y su nivel de respaldo, pero los cruces son inferencias propias.

Leyenda de respaldo: **E** = evidencia medida (estudio o benchmark), **P** = dato del proveedor sobre su propio producto, **O** = opinión de practicante o autor, **—** = sin respaldo externo.
Leyenda de estado en ODD: ✓ ya existe · ◐ existe a medias o solo en prompt · ✗ nuevo.

## 1. Inventario: la mejor pieza de cada metodología

| Metodología | Mejor pieza | Por qué es la mejor | Respaldo | En ODD |
|---|---|---|---|---|
| **Spec Kit** (SDD) | Marcador `[NEEDS CLARIFICATION]` que bloquea la spec | Convierte la ambigüedad en un estado visible, no en una suposición silenciosa | O | ◐ (regla de "una pregunta") |
| **Spec Kit** | "Complexity Tracking": justificar por escrito cuando se rompe una regla | Permite excepciones sin perder trazabilidad | O | ✗ |
| **Spec Kit** | `converge`: comparar código contra spec hasta converger | Detecta huecos entre lo pedido y lo hecho | O | ✓ (Close) |
| **Kiro** (SDD) | Quick Spec: vía rápida sin puertas | Responde a la crítica "misma ceremonia para todo" | O | ✓ (small/inline) |
| **Kiro** | Bugfix con "comportamiento que **no** cambia" | Da al verificador una prueba de regresión explícita | O | ✗ |
| **OpenSpec** (SDD) | Specs delta que se fusionan al archivar en una spec viva | Spec-anchored sin regenerar código; mata el drift | O | ✗ (los docs se borran) |
| **BMAD** | Story file: un archivo con todo lo que un agente necesita | Handoff autocontenido | O | ◐ (prompt de delegación) |
| **GSD** | Subagentes con contexto fresco; "cada plan cabe en un contexto limpio" | Ataca el context rot | E (Chroma, METR) | ✓ |
| **Traycer** | Conformidad con el plan clasificada por severidad (Critical/Major/Minor/Outdated) | Prioriza qué arreglar | P | ✗ |
| **Superpowers** | Ledger `Ruling: qué — por qué — coste si es erróneo` | Decisiones auditables sin parar la ejecución | O | ✗ |
| **Superpowers** | `progress.md` para no re-despachar trabajo hecho | Su autor lo llama el fallo más caro observado | O | ◐ (tabla `T#`) |
| **Superpowers** | Skill de autodiagnóstico sobre el transcript | La metodología se depura a sí misma | — | ✗ |
| **HumanLayer RPI** | El humano revisa el plan (200 líneas), no el código (2.000) | Pone la atención humana donde rinde | P | ◐ |
| **Ralph** | "Back pressure": tests/typecheck como freno del bucle | Bucle autónomo acotado por verificación | O | ◐ |
| **TDD Guard** | Hook PreToolUse que bloquea código sin test que falle | Única forma de que test-first no sea autodeclarado | O | ✗ |
| **OmO** | "Kibitzer": modelo barato que avisa antes de repetir un error | Memoria de errores activa, no pasiva | P | ◐ (`failure-streak`) |
| **OMC** | Revisores de otra familia de modelos | Mitiga el sesgo del juez | E (arXiv 2410.21819) | ✗ (judges Opus+Sonnet) |
| **Beck (augmented coding)** | Un test a la vez + no mezclar commits estructurales y de comportamiento | Revisión más barata, regresiones aislables | O (autor) | ✗ |
| **TDFlow** | Tests que el agente **no** escribió como oráculo | 94,3 % vs 69,8 % | **E** | ✗ |
| **Cognition** | Revisor con contexto limpio que solo ve el diff; filtrar hallazgos contra lo pedido | ~2 bugs/PR, 58 % graves | P | ✓ (lentes, "Findings never expand scope") |
| **Cognition + Anthropic** | Un escritor, muchos lectores | Coinciden dos fabricantes; MAST explica por qué | E (MAST) + P | ✓ |
| **Context engineering** | Contexto mínimo curado; AGENTS.md corto | Archivos largos/autogenerados empeoran resultados | **E** (ICLR 2026) | ✓ (contrato < 8.000) |
| **Anthropic best practices** | "Si debe ocurrir siempre, hook; el prompt es guía" | Separa reglas de sugerencias | O (fabricante) | ✓ |
| **EDD** | Evals como bucle de desarrollo | Medir comportamiento probabilístico | E (CSIRO) + P (Vercel) | ◐ (evals sin resultados publicados) |
| **IDD** | Intención duradera separada de tareas desechables | Lo que se guarda es el "qué/por qué", no el "cómo" | O | ◐ (S# literales) |
| **ODD** | Autonomía proporcional a la fuerza del verificador | Único método que hace de la verificabilidad la regla de parada | — (coherente con E) | ✓ |
| **ODD** | Resume test para dimensionar | Criterio comprobable de tamaño; SDD no lo tiene | — | ✓ (no impuesto) |
| **ODD** | Línea `Risk:` → lentes obligatorias → puerta de publicación | Ningún otro framework bloquea push por veredictos | — | ✓ (riesgo autoclasificado) |
| **ODD** | Specs como cita literal del usuario | Impide inflar requisitos (Kiro: 1 bug → 16 criterios) | — | ✓ |

## 2. El cruce, capa por capa

Cada fila combina piezas de orígenes distintos en una sola práctica. La columna "Resultado" es lo que aparecería en la metodología.

### 2.1 Intención (Authorize, Resolve)

| Se cruza | Resultado |
|---|---|
| ODD cita literal + Spec Kit `[NEEDS CLARIFICATION]` + IDD intención duradera | **`S#` literal con estado**: una spec es `clara` o `NEEDS CLARIFICATION: <pregunta>`. Ninguna tarea que dependa de una `S#` sin aclarar puede pasar a `done`. La intención (`S#`) es duradera; las tareas (`T#`) son desechables. |
| Kiro bugfix + ODD Given/When/Then opcional | **Bugfix en tres líneas**: actual / esperado / **sin cambios**. La tercera se convierte en test de regresión obligatorio. |

### 2.2 Dimensionamiento (Classify)

| Se cruza | Resultado |
|---|---|
| ODD resume test + Kiro Quick Spec + BMAD escala adaptativa | **Ceremonia proporcional**: tres vías, no dos. *Inline* (pasa resume test, Risk none) → *Tracked* (documento de feature) → *Tracked con oráculo* (Risk ≥1: tests de aceptación antes de implementar, ver 2.4). |
| Spec Kit Complexity Tracking + límites ODD (150 líneas inline, 1.500 por slice) | **Excepción justificada**: superar un límite no está prohibido, pero exige una línea `Exceeds: <límite> — <por qué>` en el Log. Esto también permite calibrar las cifras 150/1.500, que hoy no tienen respaldo. |

> Esta capa es la candidata natural a dar significado a "Organic": **el proceso crece con el tamaño y el riesgo del trabajo, en vez de aplicarse igual a todo.**

### 2.3 Persistencia de la intención (Track, Close)

| Se cruza | Resultado |
|---|---|
| ODD documento de feature + OpenSpec deltas | **El documento de feature es un delta**. Al cerrar, sus `S#` se fusionan en `odd/specs/<área>.md` (spec viva) y el documento se archiva. ODD pasa de spec-first a spec-anchored sin regenerar código. |
| Superpowers `Ruling:` + ODD Log | **Log con decisiones tipadas**: `Ruling: qué — por qué — coste si es erróneo`. Las decisiones sobreviven al documento cuando se fusiona. |
| Superpowers `progress.md` + ODD tabla `T#` + Engram | Sin cambio estructural: la tabla `T#` ya cumple el papel del ledger. Lo nuevo sería que `feature-state.mjs` marque explícitamente "no re-despachar `done`". |

### 2.4 Implementación

| Se cruza | Resultado |
|---|---|
| TDFlow (tests ajenos) + ODD un solo escritor + verifier que no escribe | **Separación de oráculo**: en la vía *Tracked con oráculo*, los tests de aceptación de cada `S#` los escribe alguien que no es el `worker` (el verifier o el humano), y el `worker` no puede editarlos (`surface-guard` ya sabe limitar superficies). Es el cruce con mejor evidencia de todo el documento. |
| TDD Guard + ODD autonomía por verificador | **Test-first impuesto donde el verificador es fuerte**: hook opcional que niega editar código de producción si no hay un test rojo registrado para la `T#`. Donde no hay verificador, no aplica (coherente con el principio de ODD). |
| Beck commits separados + ODD slices | **Commits tipados**: `refactor:` (estructural, sin cambio de comportamiento) nunca en el mismo commit que `feat:`/`fix:`. Abarata la revisión de las lentes. |

### 2.5 Verificación

| Se cruza | Resultado |
|---|---|
| ODD autonomía ∝ verificador + Ralph back pressure | **Escalera de autonomía explícita**: verificador fuerte → bucle permitido hasta verde (estilo Ralph, con tope de iteraciones); débil → un paso y parar; ninguno → proponer qué lo haría verificable. Hoy está en una línea del contrato; pasaría a ser el eje de la metodología. |
| Spec Kit converge + Traycer severidad | **Converge con severidad**: cada hueco `S#`↔código se clasifica Critical/Major/Minor. Solo Critical/Major crean `T#` nuevas; Minor va al Log. Evita el bucle de "arreglar cada hallazgo" que Anthropic desaconseja. |

### 2.6 Riesgo y revisión

| Se cruza | Resultado |
|---|---|
| ODD Risk line + Spec Kit constitution gates + detección mecánica | **Piso de riesgo**: un hook infiere un riesgo mínimo de señales objetivas (migraciones, auth, lockfiles, CI, `rm`/`DROP`, archivos de contrato). El agente puede **subir** el riesgo, nunca bajarlo del piso. Cierra la brecha "un `none` erróneo no se detecta". |
| ODD lentes + Cognition contexto limpio + OMC familias distintas | **Revisores realmente independientes**: las lentes ven diff + `S#`, nada más (ya es así), y la revisión dual usa modelos de familias distintas cuando estén disponibles. |
| Cognition filtrar hallazgos + ODD "Findings never expand scope" | Ya está. Se formaliza como principio, no como regla suelta. |

### 2.7 Publicación

| Se cruza | Resultado |
|---|---|
| ODD publication gate + piso de riesgo (2.6) | La puerta deja de depender solo de celdas que escribe el agente: un trabajo con piso de riesgo ≥1 sin documento de feature **se bloquea** (hoy pasa). |
| Faros (PR grandes → revisión más larga) + ODD slices + commits tipados | Sin cambio estructural; se documenta el porqué con la evidencia. |

### 2.8 Medición y aprendizaje

| Se cruza | Resultado |
|---|---|
| EDD + evals de ODD + `summary.json` | **La metodología se mide a sí misma**: cada principio tiene al menos un eval; cada versión publica su tasa de cumplimiento. Un cambio de regla (p. ej. 20 → 150 líneas inline) debe venir con su delta de evals. Esto frena las oscilaciones de la historia (memoria, guards, inline). |
| Superpowers diagnosing + OmO Kibitzer + `failure-streak` | **Skill `diagnose`**: lee el transcript y reporta qué regla de ODD no se cumplió y por qué. Alimenta los evals con casos reales. |

## 3. Conflictos entre piezas y cómo se resuelven

| Conflicto | Resolución propuesta |
|---|---|
| Spec completa antes (SDD) **vs** "aprenderás durante la implementación" (Beck) | Por adelantado solo la **intención literal** (`S#`); el plan y las tareas emergen y se pueden reescribir. La spec viva se actualiza al cerrar, no antes. |
| Bucle autónomo (Ralph) **vs** puertas y paradas (ODD) | El bucle solo existe **dentro** de un verificador fuerte y nunca cruza una puerta (publicación, Risk ≥1 sin aprobación). |
| Olas paralelas (Kiro, GSD) **vs** un solo escritor (Cognition, MAST) | Paralelo solo con superficies disjuntas, que ODD ya exige. Sin superficies disjuntas, secuencial. |
| Tests fijos (TDD) **vs** criterios probabilísticos (EDD) | TDD para el **código** que produce el agente; EDD para el **comportamiento de la metodología** (¿el agente cumplió el protocolo?). |
| Gestión del contexto al 40-60 % (HumanLayer) **vs** guía Anthropic 2026 (ya no hace falta) | No se importa. Se mantiene "subagente fresco por unidad" por la evidencia de context rot, sin umbral fijo. |
| Constitución extensa (Spec Kit) **vs** AGENTS.md corto (ICLR 2026) | No se importa la constitución. Los principios caben en el contrato corto; el detalle sigue en skills bajo demanda. |

## 4. Lo que se descarta

| Pieza | Origen | Por qué no |
|---|---|---|
| Constitución + 7 artefactos por feature | Spec Kit | Ceremonia que la evidencia penaliza; tedioso de revisar (Böckeler) |
| Personas de equipo ágil (Analyst, PM, Architect) | BMAD | Multiplica agentes sin evidencia; ODD ya separa por función (explorer/worker/verifier) |
| Spec-as-source | Tessl | Su principal promotor lo abandonó; misma spec, código distinto |
| Escritores en paralelo sin superficies disjuntas | GSD, Ruflo | Modo de fallo central de MAST |
| Memory bank de archivos que el agente "MUST" leer | Cline | Prompt-only y redundante con Engram |
| 300 herramientas MCP / daemon | Ruflo | Superficie enorme, sin evidencia |
| EARS como notación obligatoria | Kiro | Choca con la cita literal del usuario |

## 5. El esqueleto que sale del cruce

Seis principios, cada uno con su origen cruzado y su mecanismo. Es un borrador para discutir, no una decisión.

| # | Principio | Piezas que lo forman | Mecanismo (impuesto / prompt) |
|---|---|---|---|
| 1 | **Intención literal**: la palabra del usuario es la spec; la ambigüedad es un estado, no una suposición | ODD, IDD, Spec Kit | `S#` con estado; tareas bloqueadas por `NEEDS CLARIFICATION` (hook posible) |
| 2 | **Ceremonia proporcional**: el proceso crece con el tamaño y el riesgo | ODD resume test, Kiro Quick Spec, BMAD, Spec Kit Complexity Tracking | Tres vías + `Exceeds:` justificado |
| 3 | **Autonomía proporcional a la verificación** | ODD, Ralph, TDD Guard | Escalera explícita; test-first impuesto donde el verificador es fuerte |
| 4 | **Oráculos ajenos, un escritor, revisores limpios** | TDFlow, Cognition, MAST, OMC | Separación de oráculo; lentes con contexto limpio; jueces de familias distintas |
| 5 | **Riesgo declarado con piso mecánico, publicación por evidencia** | ODD, Spec Kit gates | Piso de riesgo (hook) + publication gate |
| 6 | **La metodología se mide a sí misma** | EDD, Superpowers diagnosing, OpenSpec spec viva | Evals por principio con resultados publicados; skill `diagnose`; spec viva |

## 6. Prioridad sugerida (respaldo × coste)

| Orden | Pieza | Respaldo | Coste estimado | Cierra qué brecha |
|---|---|---|---|---|
| 1 | Separación de oráculo (2.4) | **E** | Medio (rol del verifier + superficie) | Test-first autodeclarado |
| 2 | Piso de riesgo (2.6) | — (cierra brecha documentada) | Medio (hook nuevo) | `none` erróneo no detectado; trabajo riesgoso sin documento |
| 3 | Evals con resultados publicados (2.8) | E (EDD) | Bajo (ya existen evals y `summary.json`) | Sin datos de cumplimiento |
| 4 | Spec viva con deltas (2.3) | O | Medio | Drift; documentos borrados |
| 5 | Converge con severidad (2.5) | P | Bajo | Bucles de hallazgos |
| 6 | `S#` con `NEEDS CLARIFICATION` (2.1) | O | Bajo | Suposiciones silenciosas |
| 7 | Bugfix "sin cambios", `Ruling:`, `Exceeds:`, commits tipados | O | Bajo (texto en skills) | Trazabilidad |
| 8 | Test-first impuesto (TDD Guard), skill `diagnose`, jueces de otra familia | O / E | Medio-alto | Opcionales |

Estimaciones de coste: inferencia, no medidas. Ninguna pieza se ha implementado ni probado.
