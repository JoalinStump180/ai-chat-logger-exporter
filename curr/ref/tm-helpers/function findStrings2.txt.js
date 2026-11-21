function findStrings2(searchString, caseSensitive = false, quiet   = true) {
    if (!searchString) {
        console.warn('No search string provided.');
        return null;
    }
    const results = [];

    function getDomPath(node) {
        const path = [];
        let currentNode = node;
        while (currentNode && currentNode !== document) {
            let selector = currentNode.nodeName.toLowerCase();
            if (currentNode.parentNode) {
                const siblings = Array.from(currentNode.parentNode.childNodes)
                    .filter(n => n.nodeName === currentNode.nodeName && n.nodeType === currentNode.nodeType);
                if (siblings.length > 1) {
                    const index = siblings.indexOf(currentNode) + 1;
                    selector += `:nth-child(${index})`;
                }
            }
            if (currentNode.id) {
                selector += `#${currentNode.id}`;
            } else if (currentNode.className && typeof currentNode.className === 'string') {
                const classes = currentNode.className.trim().split(/\s+/).join('.');
                if (classes) selector += `.${classes}`;
            }
            path.unshift(selector);
            currentNode = currentNode.parentNode;
        }
        return path.join(' > ');
    }

    const checkIncludes = caseSensitive
        ? (text) => text.includes(searchString)
        : (text) => text.toLowerCase().includes(searchString.toLowerCase());

    function traverseDOM(node) {
        if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.ELEMENT_NODE) {
            const text = node.textContent;
            if (text && checkIncludes(text)) {
                const trimmed = text.trim();
                if (trimmed) {
                    const match = {
                        type: 'text',
                        content: trimmed,
                        fullContent: text,
                        domPath: getDomPath(node)
                    };
                    results.push(match);
                    if (!quiet) console.log(match);
                }
            }
        }
        if (node.attributes) {
            Array.from(node.attributes).forEach(attr => {
                if (attr.value && checkIncludes(attr.value)) {
                    const match = {
                        type: 'attribute',
                        attribute: attr.name,
                        content: attr.value,
                        domPath: `${getDomPath(node)}[@${attr.name}]`
                    };
                    results.push(match);
                   if (!quiet)  console.log(match);
                }
            });
        }
        node.childNodes.forEach(child => traverseDOM(child));
    }

    traverseDOM(document.body);
    return results.length ? results : null;   // hit → array; miss → null
}