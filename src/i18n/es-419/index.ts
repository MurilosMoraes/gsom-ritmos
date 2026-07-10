import { main } from './main';
import { auth } from './auth';
import { plans } from './plans';
import { demo } from './demo';
import { ui } from './ui';
import { core } from './core';

export const dict: Record<string, string> = {
  ...main,
  ...auth,
  ...plans,
  ...demo,
  ...ui,
  ...core,
};
