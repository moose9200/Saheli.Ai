import type { DialectProfile } from "../indic/registry.js";

/**
 * The four tools. Deliberately four.
 *
 * Every tool is a place where the model can act on a household's real life, so
 * each one is fenced:
 *  - `proposeMemoryFact` never writes. It returns a *proposal* the user must
 *    approve in the UI. Memory is the highest-risk surface (DPDP Act 2023:
 *    consent must be specific and revocable), so the agent cannot self-grant it.
 *  - reminders and lists are household-scoped and reversible — safe to act.
 *  - `escalateSafetyRisk` is the only tool that can interrupt the conversation,
 *    and it can only ever surface help, never take an action on the user's behalf.
 *
 * Adding a fifth tool means writing down what stops it being abused. There is no
 * fifth tool today.
 */

export interface ToolContext {
  tenantId: string;
  profileId: string;
  dialect: DialectProfile;
}

export interface PendingMemory {
  kind: "memory-proposal";
  fact: string;
  category: "preference" | "routine" | "family" | "health" | "other";
  requiresApproval: true;
}

export interface Reminder {
  kind: "reminder";
  id: string;
  title: string;
  /** ISO 8601. Relative phrases are resolved by the model, checked here. */
  when: string;
  recurrence: "none" | "daily" | "weekly" | "monthly";
}

export interface ShoppingListUpdate {
  kind: "shopping-list";
  action: "add" | "remove" | "clear";
  items: string[];
}

export interface SafetyEscalation {
  kind: "safety";
  category: "self-harm" | "domestic-abuse" | "medical-emergency" | "financial-coercion" | "child-safety";
  severity: "watch" | "urgent";
}

export type ToolResult = PendingMemory | Reminder | ShoppingListUpdate | SafetyEscalation;

/** JSON-schema declarations in the shape the Gemini SDK expects. */
export const TOOL_DECLARATIONS = [
  {
    name: "proposeMemoryFact",
    description:
      "Propose something worth remembering about the user for future conversations — a preference, routine, family detail. " +
      "This does NOT save anything; it creates a proposal the user must approve. Never claim you have remembered something.",
    parameters: {
      type: "object",
      properties: {
        fact: { type: "string", description: "One short sentence, in the user's language." },
        category: { type: "string", enum: ["preference", "routine", "family", "health", "other"] },
      },
      required: ["fact", "category"],
    },
  },
  {
    name: "createHouseholdReminder",
    description:
      "Create a reminder in the shared household space. Use only when the user asks for a reminder or clearly wants one.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        when: { type: "string", description: "ISO 8601 date-time." },
        recurrence: { type: "string", enum: ["none", "daily", "weekly", "monthly"] },
      },
      required: ["title", "when"],
    },
  },
  {
    name: "updateShoppingList",
    description: "Add to, remove from, or clear the household shopping list.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "remove", "clear"] },
        items: { type: "array", items: { type: "string" } },
      },
      required: ["action", "items"],
    },
  },
  {
    name: "escalateSafetyRisk",
    description:
      "Surface emergency help. Use when the user mentions self-harm, violence at home, a medical emergency, financial coercion, or danger to a child. " +
      "This only shows helplines — it never contacts anyone.",
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["self-harm", "domestic-abuse", "medical-emergency", "financial-coercion", "child-safety"] },
        severity: { type: "string", enum: ["watch", "urgent"] },
      },
      required: ["category", "severity"],
    },
  },
] as const;

function id(): string {
  return `r_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Execute a tool call. Pure and synchronous except for the id: nothing here
 * touches the database. Persistence is the caller's job, which keeps the
 * approval gate in one place instead of scattered across handlers.
 */
export function executeTool(name: string, args: Record<string, unknown>, _ctx: ToolContext): ToolResult {
  switch (name) {
    case "proposeMemoryFact": {
      const category = String(args.category ?? "other");
      return {
        kind: "memory-proposal",
        fact: String(args.fact ?? "").trim(),
        category: (["preference", "routine", "family", "health", "other"].includes(category) ? category : "other") as PendingMemory["category"],
        requiresApproval: true,
      };
    }

    case "createHouseholdReminder": {
      const when = String(args.when ?? "");
      // Reject unparseable times rather than saving a reminder that never fires.
      if (Number.isNaN(Date.parse(when))) throw new Error("createHouseholdReminder: `when` is not a valid date");
      const recurrence = String(args.recurrence ?? "none");
      return {
        kind: "reminder",
        id: id(),
        title: String(args.title ?? "").trim(),
        when: new Date(when).toISOString(),
        recurrence: (["none", "daily", "weekly", "monthly"].includes(recurrence) ? recurrence : "none") as Reminder["recurrence"],
      };
    }

    case "updateShoppingList": {
      const action = String(args.action ?? "add");
      const items = Array.isArray(args.items) ? args.items.map((i) => String(i).trim()).filter(Boolean) : [];
      if (action !== "clear" && items.length === 0) throw new Error("updateShoppingList: no items given");
      return { kind: "shopping-list", action: action as ShoppingListUpdate["action"], items };
    }

    case "escalateSafetyRisk":
      return {
        kind: "safety",
        category: String(args.category ?? "medical-emergency") as SafetyEscalation["category"],
        severity: String(args.severity ?? "urgent") as SafetyEscalation["severity"],
      };

    default:
      throw new Error(`unknown tool: ${name}`);
  }
}
