import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const interactionSource = readFileSync('src/components/aiNative/SalesAgentInteractionWorkspace.tsx', 'utf8');
const workspaceSource = readFileSync('src/components/aiNative/AINativeCRMWorkspace.tsx', 'utf8');

describe('Sales Agent no production window hooks', () => {
  it('SalesAgentInteractionWorkspace has no __salesAgentSubmitPrompt or __salesAgentResetConversation', () => {
    expect(interactionSource).not.toContain('__salesAgentSubmitPrompt');
    expect(interactionSource).not.toContain('__salesAgentResetConversation');
  });

  it('AINativeCRMWorkspace has no __salesAgentSubmitPrompt or __salesAgentResetConversation', () => {
    expect(workspaceSource).not.toContain('__salesAgentSubmitPrompt');
    expect(workspaceSource).not.toContain('__salesAgentResetConversation');
  });
});
