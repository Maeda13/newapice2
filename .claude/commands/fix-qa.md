---
description: Corrige um achado específico do backlog de auditoria de QA (CLAUDE.md), com teste vermelho → verde e commit isolado.
argument-hint: QA-XXX
---

Você vai corrigir **um único achado** do backlog de auditoria em `CLAUDE.md`, identificado por `$1` (ex.: `QA-001`). Não toque em nenhum outro achado, mesmo que veja algo relacionado.

## 1. Ler o achado

Abra `CLAUDE.md` e encontre a linha de `$1` na tabela, depois a seção de detalhe correspondente (`## $1 — ...`), com Severidade, Categoria, Arquivos, Problema, Por que é um problema, Como reproduzir, Solução recomendada e Risco da correção.

Se `$1` não existir no arquivo, ou o status já for `fixed`/`verified`/`wontfix`, pare e diga isso — não invente um achado nem refaça um já resolvido.

## 2. Escrever o teste em `tests/qa/$1.test.js`

O teste deve capturar exatamente o problema descrito, escolhendo a estratégia certa para a categoria:

- **XSS / escape ausente**: teste de inspeção estática — leia o(s) arquivo(s) de `views/` listados e verifique que a interpolação vulnerável está envolvida por uma chamada de escape (`escapeHtml(...)`/`escHtml(...)`), não a variável crua. Se ainda não existir uma função de escape compartilhada, o teste pode primeiro exercitar a função (uma vez criada em `public/js/`) com um payload como `<img src=x onerror=alert(1)>` e afirmar que o resultado não contém `<img`.
- **Backend/rota/validação**: teste com `supertest` contra o app Express (`require('../../server')` ou equivalente — confira como `server.js` exporta a app antes de assumir).
- **CSS (z-index, cor, breakpoint)**: leia o arquivo CSS relevante e afirme o valor esperado da propriedade (regex ou parser simples), já que não há navegador real no ambiente de teste.
- **HTML/acessibilidade (headings, labels, atributos)**: leia o arquivo `.ejs` e afirme a presença/ausência do atributo ou tag esperado.

Use Jest (`test()`/`expect()`, já configurado — `npm test` roda `jest --passWithNoTests`). Escreva só o teste necessário para este achado, sem generalizar demais.

## 3. Rodar e mostrar vermelho

Rode `npm test -- tests/qa/$1.test.js` (ou `npx jest tests/qa/$1.test.js`) e mostre a saída — o teste **precisa falhar** aqui, confirmando que ele realmente captura o bug descrito. Se passar de primeira, o teste está errado ou não testa o problema real — ajuste antes de continuar.

## 4. Aplicar a correção

Aplique exatamente a "Solução recomendada" do achado, no menor escopo possível (arquivos/linhas listados em "Arquivos"). Não refatore nada fora disso, não mude comportamento não relacionado ao achado.

## 5. Rodar e mostrar verde

Rode o mesmo comando de novo — o teste tem que passar agora. Depois rode `npm test` completo (sem filtro) para garantir que nada mais quebrou.

## 6. Atualizar o status no CLAUDE.md

Na tabela e na seção de detalhe de `$1`, troque `Status: pending` para `Status: fixed`.

## 7. Commitar num branch isolado

```
git checkout -b fix/qa-$1-<slug-curto-do-titulo>
git add tests/qa/$1.test.js CLAUDE.md <arquivos corrigidos>
git commit -m "fix($1): <resumo curto do problema>"
```

Não dê `git push`. Não volte para a branch anterior automaticamente — deixe o branch `fix/qa-$1-...` como está, pronto para revisão humana.

## Se algo travar

Se qualquer comando (`npm install`, `npm test`, `npm start`, etc.) não se comportar como a seção "Como rodar" do `CLAUDE.md` descreve, pare e reporte exatamente o comando e o erro — não adivinhe um comando alternativo silenciosamente.
