// Dicionário pt-BR — MASTER. Um módulo por arquivo-fonte de origem
// (extração paralela e diffs revisáveis). Valores são BYTE-IDÊNTICOS aos
// literais que estavam no código — qualquer mudança de copy é decisão de
// produto, não de refatoração.

import { main } from './main';
import { auth } from './auth';
import { plans } from './plans';
import { demo } from './demo';
import { ui } from './ui';
import { core } from './core';

export const pt: Record<string, string> = {
  ...main,
  ...auth,
  ...plans,
  ...demo,
  ...ui,
  ...core,
};
