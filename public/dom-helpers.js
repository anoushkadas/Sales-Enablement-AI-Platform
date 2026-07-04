// Tiny DOM-building helper — no framework needed.
// el('div', { className: 'card', onclick: fn }, [child1, child2, 'text'])
function el(tag, attrs, children) {
  const node = document.createElement(tag);
  attrs = attrs || {};
  Object.keys(attrs).forEach(key => {
    const val = attrs[key];
    if (val == null) return;
    if (key === "className") node.className = val;
    else if (key === "style" && typeof val === "object") Object.assign(node.style, val);
    else if (key.startsWith("on") && typeof val === "function") node.addEventListener(key.slice(2).toLowerCase(), val);
    else if (key === "html") node.innerHTML = val;
    else if (key === "value") node.value = val;
    else if (key === "checked") node.checked = val;
    else if (key === "disabled") node.disabled = val;
    else node.setAttribute(key, val);
  });
  (children || []).forEach(child => {
    if (child == null || child === false) return;
    if (typeof child === "string" || typeof child === "number") node.appendChild(document.createTextNode(String(child)));
    else if (Array.isArray(child)) child.forEach(c => c && node.appendChild(c));
    else node.appendChild(child);
  });
  return node;
}

// Icon helper that returns a DOM node from the icon() SVG-string function in icons.js
function iconEl(name, size, color, strokeWidth) {
  const span = document.createElement("span");
  span.className = "icon";
  span.innerHTML = window.icon(name, size || 18, color || "currentColor", strokeWidth || 1.8);
  return span;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function mount(parent, node) {
  clear(parent);
  parent.appendChild(node);
}

window.DOMHelpers = { el, iconEl, clear, mount };
