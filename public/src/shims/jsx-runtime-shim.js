// Shim do automatic JSX runtime ('react/jsx-runtime') sobre o React UMD
// global (que não exporta jsx/jsxs). Implementação mínima via createElement —
// suficiente pra libs pré-compiladas como o recharts.
const React = window.React;

function jsx(type, props, key) {
  const { children, ...rest } = props || {};
  if (key !== undefined) rest.key = key;
  if (children === undefined) return React.createElement(type, rest);
  return Array.isArray(children)
    ? React.createElement(type, rest, ...children)
    : React.createElement(type, rest, children);
}

module.exports = {
  Fragment: React.Fragment,
  jsx,
  jsxs: jsx,
};
