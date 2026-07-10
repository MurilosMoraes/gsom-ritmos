import { main } from './main';
import { auth } from './auth';
import { plans } from './plans';
import { demo } from './demo';
import { ui } from './ui';
import { core } from './core';
import { htmlApp } from './htmlApp';
import { htmlAuth } from './htmlAuth';
import { htmlPlans } from './htmlPlans';

export const dict: Record<string, string> = {
  ...main,
  ...auth,
  ...plans,
  ...demo,
  ...ui,
  ...core,
  ...htmlApp,
  ...htmlAuth,
  ...htmlPlans,
};
