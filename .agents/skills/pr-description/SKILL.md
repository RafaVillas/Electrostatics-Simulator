---
name: pr-description
description: Generate raw markdown PR descriptions in Spanish. Use when the user asks for a PR description or raw md for a PR.
---

# PR Description

Generate a raw markdown PR description in Spanish for the current branch.

## Process

1. Run `git log --oneline <current-branch> ^<base-branch>` to get commits.
2. Run `git diff --stat <base-branch>...<current-branch>` to get changed files.
3. Generate the description following the format below.

## Format

```markdown
## <tipo>: <título corto>

### Resumen

- Bullet points describiendo los cambios principales (qué se hizo y por qué)
- Agrupar por dominio, no por commit

### Archivos nuevos

| Ruta           | Descripción       |
| -------------- | ----------------- |
| `path/to/file` | Descripción corta |

(Solo si hay archivos nuevos relevantes, omitir archivos de config triviales)

### Dependencias nuevas

- `package` — para qué se usa

(Solo si se agregaron dependencias)

### Plan de pruebas

- [ ] Checklist de cosas a verificar manualmente

### Notas

- Cualquier contexto adicional, branches pendientes, relación con otras PRs
```

## Título de la PR

El título de la PR es lo que queda como mensaje del squash merge, así que debe ser un buen commit message:

- Usar conventional commits: `feat(scope): descripción`, `fix(scope): descripción`, etc.
- Máximo 72 caracteres
- En inglés (los commits son en inglés, el body de la PR en español)
- Describir QUÉ se logra, no los detalles internos
- Ejemplos buenos: `feat(ui): add feed and post detail views`, `feat(layout): add dashboard shell with sidebar and navbar`
- Ejemplos malos: `update components`, `PR changes`, `feat: many things`

## Rules

- El body de la PR se escribe en español
- Ser conciso, no repetir lo que ya dice el diff
- No incluir archivos de lock (package-lock.json) en la tabla
- Si la PR es parte de una cadena de branches, mencionar las PRs relacionadas en Notas
- Se usa **squash and merge**, por lo tanto el título de la PR será el commit final en la branch base
