function loc(parts) {
  let s = "";
  for (const p of parts) s += typeof p === "number" ? `[${p}]` : s ? `.${p}` : String(p);
  return s || "(root)";
}

function typeOk(value, type) {
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "null") return value === null;
  return typeof value === type;
}

function kindOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export function validate(data, schema) {
  const errors = [];
  const resolve = (node) => {
    if (!node || !node.$ref) return node;
    let cur = schema;
    for (const part of node.$ref.replace(/^#\//, "").split("/")) cur = cur?.[part];
    if (!cur) errors.push({ path: "(schema)", reason: `unresolved ${node.$ref}` });
    return cur || {};
  };

  const check = (value, raw, parts, sink) => {
    const s = resolve(raw);
    if (!s || typeof s !== "object") return;

    if (Array.isArray(s.oneOf)) {
      let matched = 0;
      for (const sub of s.oneOf) {
        const local = [];
        check(value, sub, parts, local);
        if (local.length === 0) matched += 1;
      }
      if (matched !== 1) {
        sink.push({
          path: loc(parts),
          reason: matched === 0 ? "matched no allowed shape" : "matched more than one shape"
        });
      }
      return;
    }

    if (s.type) {
      const types = Array.isArray(s.type) ? s.type : [s.type];
      if (!types.some((t) => typeOk(value, t))) {
        sink.push({ path: loc(parts), reason: `expected ${types.join(" or ")}, got ${kindOf(value)}` });
        return;
      }
    }

    if (s.enum && !s.enum.some((v) => v === value)) {
      sink.push({
        path: loc(parts),
        reason: `expected one of ${s.enum.map((v) => JSON.stringify(v)).join(", ")}`
      });
    }

    if (typeof value === "string") {
      if (s.pattern && !new RegExp(s.pattern).test(value)) {
        sink.push({ path: loc(parts), reason: `does not match ${s.pattern}` });
      }
      if (s.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        sink.push({ path: loc(parts), reason: "is not an email address" });
      }
      if (s.minLength != null && value.length < s.minLength) {
        sink.push({ path: loc(parts), reason: `must be at least ${s.minLength} characters` });
      }
      if (s.maxLength != null && value.length > s.maxLength) {
        sink.push({ path: loc(parts), reason: `must be at most ${s.maxLength} characters` });
      }
    }

    if (typeof value === "number") {
      if (s.minimum != null && value < s.minimum) sink.push({ path: loc(parts), reason: `must be >= ${s.minimum}` });
      if (s.maximum != null && value > s.maximum) sink.push({ path: loc(parts), reason: `must be <= ${s.maximum}` });
    }

    if (s.const !== undefined && value !== s.const) {
      sink.push({ path: loc(parts), reason: `must be ${JSON.stringify(s.const)}` });
    }

    if (value && typeof value === "object" && !Array.isArray(value)) {
      const props = s.properties || {};
      for (const key of s.required || []) {
        if (value[key] === undefined) sink.push({ path: loc([...parts, key]), reason: "required property is missing" });
      }
      if (s.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!Object.prototype.hasOwnProperty.call(props, key)) {
            sink.push({ path: loc([...parts, key]), reason: "additional property is not allowed" });
          }
        }
      }
      for (const [key, sub] of Object.entries(props)) {
        if (value[key] !== undefined) check(value[key], sub, [...parts, key], sink);
      }
    }

    if (Array.isArray(value)) {
      if (s.maxItems != null && value.length > s.maxItems) {
        sink.push({ path: loc(parts), reason: `must have at most ${s.maxItems} items` });
      }
      if (s.minItems != null && value.length < s.minItems) {
        sink.push({ path: loc(parts), reason: `must have at least ${s.minItems} items` });
      }
      if (s.uniqueItems) {
        const seen = new Set();
        for (const item of value) {
          const key = JSON.stringify(item);
          if (seen.has(key)) {
            sink.push({ path: loc(parts), reason: "items must be unique" });
            break;
          }
          seen.add(key);
        }
      }
      if (s.items) value.forEach((item, i) => check(item, s.items, [...parts, i], sink));
    }
  };

  check(data, schema, [], errors);
  return errors;
}
