import type {
  DescMessage,
  MessageInitShape,
  MessageShape,
} from "@bufbuild/protobuf";
import { create } from "@bufbuild/protobuf";
import type { Path } from "@bufbuild/protobuf/reflect";
import type { Violation } from "@bufbuild/protovalidate";
import { toNestErrors } from "@hookform/resolvers";
import type {
  FieldErrors,
  FieldValues,
  Resolver,
  ResolverOptions,
} from "react-hook-form";

/**
 * react-hook-form resolver that validates a form with the SAME Protovalidate
 * rules the server enforces on the API message the form submits (the rules are
 * embedded in the generated `*_pb.ts` descriptors by `pnpm connect:generate`),
 * so a constraint is written once, in the .proto file.
 *
 * Why not the stock `standardSchemaResolver` from @hookform/resolvers: form
 * state is not the wire message (a `<input type="date">` string vs. a
 * Timestamp, trimming, optional ids), so values must be mapped to the message
 * first; `toMessage` is that seam. Zod stays for client-only forms and env.
 *
 * The validator (CEL + RE2 engines) is loaded with a dynamic import on first
 * validation so it never lands in a route's initial JavaScript.
 */
export type ProtovalidateResolverOptions<
  Desc extends DescMessage,
  TValues extends FieldValues,
> = {
  /** Maps current form values to the API message that would be sent. */
  toMessage: (values: TValues) => MessageInitShape<Desc>;
  /** Violation field path (proto camelCase, dotted) -> form field name. */
  fieldMap?: Readonly<Record<string, string>>;
  /**
   * Message fields the form does not collect (e.g. an id supplied at submit
   * time); their violations are ignored here, the server still enforces them.
   */
  omit?: readonly string[];
};

type ValidatorModule = typeof import("@bufbuild/protovalidate");
type Validator = ReturnType<ValidatorModule["createValidator"]>;

let validatorPromise: Promise<Validator> | undefined;

function loadValidator(): Promise<Validator> {
  validatorPromise ??= import("@bufbuild/protovalidate").then((mod) =>
    mod.createValidator(),
  );
  return validatorPromise;
}

/** `["items", {list_sub 0}, "name"]` -> `items.0.name` (react-hook-form paths). */
function violationFieldName(path: Path): string {
  return path
    .map((element) => {
      if ("localName" in element) {
        return element.localName;
      }
      if (element.kind === "list_sub") {
        return String(element.index);
      }
      if (element.kind === "map_sub") {
        return String(element.key);
      }
      return "";
    })
    .filter((part) => part !== "")
    .join(".");
}

export function protovalidateResolver<
  Desc extends DescMessage,
  TValues extends FieldValues,
>(
  schema: Desc,
  {
    toMessage,
    fieldMap = {},
    omit = [],
  }: ProtovalidateResolverOptions<Desc, TValues>,
): Resolver<TValues> {
  return async (values, _context, options: ResolverOptions<TValues>) => {
    const validator = await loadValidator();
    const message = create(schema, toMessage(values)) as MessageShape<Desc>;
    const result = validator.validate(schema, message);

    if (result.kind === "valid") {
      return { values, errors: {} };
    }

    const errors: Record<string, { type: string; message: string }> = {};
    if (result.kind === "error") {
      // Fail closed: a rule that cannot be evaluated blocks the submit. The
      // server remains the authority and will answer with the real error.
      errors.root = { type: "protovalidate", message: result.error.message };
    } else {
      for (const violation of result.violations as Violation[]) {
        const path = violationFieldName(violation.field);
        if (omit.includes(path)) {
          continue;
        }
        const name = fieldMap[path] ?? (path === "" ? "root" : path);
        // First violation per field wins, like RHF's own criteriaMode default.
        if (!(name in errors)) {
          errors[name] = {
            type: violation.ruleId,
            message: violation.message,
          };
        }
      }
    }

    if (Object.keys(errors).length === 0) {
      // Every violation was for an omitted field: the form itself is valid.
      return { values, errors: {} };
    }

    return {
      values: {},
      errors: toNestErrors(errors as FieldErrors, options),
    };
  };
}
