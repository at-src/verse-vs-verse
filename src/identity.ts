import { config } from './config.js';

export type CreditIdentity = { login: string; userId: string; text: string };

export function applyActorPersona(senderLogin: string, senderId: string, rawText: string, actorLogins = config.demoActorLogins): CreditIdentity {
  const actor = actorLogins.includes(senderLogin.toLowerCase());
  if (!actor) return { login: senderLogin, userId: senderId, text: rawText };
  const match = rawText.match(/^\s*(!line\s+|![1-4]\s+)\[([a-zA-Z0-9_]+)\]\s*/);
  if (!match) return { login: senderLogin, userId: senderId, text: rawText };
  const command = match[1]!.trimEnd();
  const remainder = rawText.slice(match[0].length);
  return {
    login: match[2]!.toLowerCase(), userId: `persona:${match[2]!.toLowerCase()}`,
    text: remainder ? `${command} ${remainder}` : command,
  };
}
