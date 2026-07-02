(function () {
    function escapeHtml(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function escapeAttr(text) {
        return escapeHtml(text).replace(/"/g, '&quot;');
    }

    function decodeHtmlEntities(text) {
        const textarea = document.createElement('textarea');
        textarea.innerHTML = String(text || '');
        return textarea.value;
    }

    function htmlToPlainText(rawHtml) {
        if (!rawHtml) return '';
        let text = String(rawHtml);
        text = text.replace(/<\s*br\s*\/?>/gi, '\n');
        text = text.replace(/<\/\s*(p|div|li|h[1-6]|blockquote|pre|tr)\s*>/gi, '\n');
        text = text.replace(/<\/\s*(ul|ol|table)\s*>/gi, '\n');
        text = text.replace(/<[^>]+>/g, '');
        text = decodeHtmlEntities(text);
        text = text.replace(/\r/g, '\n').replace(/\u00a0/g, ' ');
        const rawLines = text.split('\n');
        const cleaned = [];
        let blankRun = 0;
        for (const rawLine of rawLines) {
            const line = rawLine.replace(/\s+/g, ' ').trimEnd();
            if (!line.trim()) {
                blankRun += 1;
                if (blankRun > 1) continue;
                cleaned.push('');
                continue;
            }
            blankRun = 0;
            cleaned.push(line.trim());
        }
        return cleaned.join('\n').trim();
    }

    function hasSubstantiveHtml(rawHtml) {
        if (!rawHtml || !String(rawHtml).trim()) return false;
        const wrapper = document.createElement('div');
        wrapper.innerHTML = String(rawHtml);
        const elements = wrapper.querySelectorAll('*');
        for (const el of elements) {
            const tag = el.tagName.toLowerCase();
            if (tag === 'div' || tag === 'p' || tag === 'br') {
                if (el.attributes && el.attributes.length > 0) {
                    return true;
                }
                continue;
            }
            return true;
        }
        return false;
    }

    function looksLikeMarkdown(text) {
        const source = String(text || '').replace(/\r\n?/g, '\n').trim();
        if (!source) return false;
        const patterns = [
            /(^|\n)\s{0,3}#{1,6}(?:\s+\S|(?=\S)\S)/,
            /(^|\n)\s{0,3}[-*+]\s+\S+/,
            /(^|\n)\s{0,3}\d+[.)]\s+\S+/,
            /(^|\n)\s{0,3}>\s+\S+/,
            /(^|\n)\s{0,3}(```|~~~)/,
            /\[([^\]\n]+)\]\((https?:\/\/|mailto:)[^)]+\)/i,
            /(^|[^\*])\*\*[^*\n]+\*\*(?!\*)/,
            /(^|[^_])__[^_\n]+__(?!_)/,
            /(^|[^\*])\*[^*\n]+\*(?!\*)/,
            /(^|[^_])_[^_\n]+_(?!_)/,
            /`[^`\n]+`/,
            /~~[^~\n]+~~/,
            /(^|\n)\s{0,3}(?:[-*_]\s*){3,}$/
        ];
        return patterns.some((pattern) => pattern.test(source));
    }

    function renderInlineMarkdown(text) {
        let source = String(text || '');
        const placeholders = [];

        source = source.replace(/`([^`\n]+)`/g, (_, code) => {
            const token = `@@MDTOKEN_${placeholders.length}@@`;
            placeholders.push(`<code>${escapeHtml(code)}</code>`);
            return token;
        });

        // ![alt](url) -> image
        source = source.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/gi, (_, alt, url) => {
            const token = `@@MDTOKEN_${placeholders.length}@@`;
            placeholders.push(
                `<div class="note-image-wrapper" contenteditable="false"><img class="note-embedded-image" src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" style="max-width:100%"></div>`
            );
            return token;
        });

        source = source.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match, label, url) => {
            const lowerUrl = String(url || '').toLowerCase();
            if (!lowerUrl.startsWith('http://') && !lowerUrl.startsWith('https://') && !lowerUrl.startsWith('mailto:')) {
                return match;
            }
            const token = `@@MDTOKEN_${placeholders.length}@@`;
            placeholders.push(
                `<a href="${escapeAttr(url)}" class="external-link" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`
            );
            return token;
        });

        source = escapeHtml(source);
        source = source.replace(/(\*\*|__)(.+?)\1/g, '<strong>$2</strong>');
        source = source.replace(/~~(.+?)~~/g, '<del>$1</del>');
        source = source.replace(/==(.+?)==/g, '<mark>$1</mark>');
        source = source.replace(/(^|[^\*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
        source = source.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');

        source = source.replace(/@@MDTOKEN_(\d+)@@/g, (_, index) => {
            const parsed = parseInt(index, 10);
            return Number.isFinite(parsed) ? (placeholders[parsed] || '') : '';
        });

        return source;
    }

    function renderMarkdownListItem(itemBody) {
        const taskMatch = itemBody.match(/^\[( |x|X)?\]\s*([\s\S]*)$/);
        if (taskMatch) {
            const checked = taskMatch[1].toLowerCase() === 'x';
            const body = taskMatch[2]
                .split('\n')
                .map((line) => renderInlineMarkdown(line.trim()))
                .join('<br>');
            return `<li><span class="note-inline-checkbox"><input type="checkbox"${checked ? ' checked' : ''}> ${body}</span></li>`;
        }
        const body = itemBody
            .split('\n')
            .map((line) => renderInlineMarkdown(line.trim()))
            .join('<br>');
        return `<li>${body}</li>`;
    }

    function isHorizontalRule(line) {
        return /^\s{0,3}(?:[-*_]\s*){3,}$/.test(line || '');
    }

    function isFenceStart(line) {
        return /^\s{0,3}(```|~~~)/.test(line || '');
    }

    function parseMarkdownBlocks(text) {
        const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
        const blocks = [];
        let i = 0;

        const isUnorderedItem = (line) => /^\s{0,3}[-*+]\s+/.test(line || '');
        const isOrderedItem = (line) => /^\s{0,3}\d+[.)]\s+/.test(line || '');
        const isTableRow = (line) => /^\s*\|.+\|/.test(line || '');
        const isTableSeparator = (line) => /^\s*\|[\s:]*-+[\s:]*(\|[\s:]*-+[\s:]*)*\|/.test(line || '');
        const isBlockStart = (line) => {
            if (!line || !line.trim()) return false;
            return (
                isFenceStart(line) ||
                /^\s{0,3}#{1,6}/.test(line) ||
                /^\s{0,3}>\s?/.test(line) ||
                isHorizontalRule(line) ||
                isUnorderedItem(line) ||
                isOrderedItem(line) ||
                isTableRow(line)
            );
        };

        while (i < lines.length) {
            const current = lines[i];
            if (!current.trim()) {
                i += 1;
                continue;
            }

            if (isFenceStart(current)) {
                const fence = current.trim().slice(0, 3);
                const codeLines = [];
                i += 1;
                while (i < lines.length && !lines[i].trim().startsWith(fence)) {
                    codeLines.push(lines[i]);
                    i += 1;
                }
                if (i < lines.length && lines[i].trim().startsWith(fence)) {
                    i += 1;
                }
                blocks.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
                continue;
            }

            const headingMatch = current.match(/^\s{0,3}(#{1,6})(?:\s+|(?=\S))(.+?)\s*#*\s*$/);
            if (headingMatch) {
                const level = Math.min(6, headingMatch[1].length);
                blocks.push(`<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`);
                i += 1;
                continue;
            }

            if (isHorizontalRule(current)) {
                blocks.push('<hr>');
                i += 1;
                continue;
            }

            if (/^\s{0,3}>\s?/.test(current)) {
                const quoteLines = [];
                while (i < lines.length && /^\s{0,3}>\s?/.test(lines[i])) {
                    quoteLines.push(lines[i].replace(/^\s{0,3}>\s?/, ''));
                    i += 1;
                }
                const quoteHtml = quoteLines.map((line) => renderInlineMarkdown(line)).join('<br>');
                blocks.push(`<blockquote>${quoteHtml}</blockquote>`);
                continue;
            }

            if (isUnorderedItem(current) || isOrderedItem(current)) {
                const ordered = isOrderedItem(current);
                const tag = ordered ? 'ol' : 'ul';
                const marker = ordered ? /^\s{0,3}\d+[.)]\s+(.*)$/ : /^\s{0,3}[-*+]\s+(.*)$/;
                const items = [];

                while (i < lines.length) {
                    const line = lines[i];
                    const match = line.match(marker);
                    if (!match) break;
                    let body = match[1] || '';
                    i += 1;

                    while (i < lines.length) {
                        const next = lines[i];
                        if (!next.trim()) break;
                        if (next.match(marker) || (ordered ? isUnorderedItem(next) : isOrderedItem(next))) break;
                        if (isBlockStart(next)) break;
                        body += `\n${next.trim()}`;
                        i += 1;
                    }

                    items.push(renderMarkdownListItem(body.trim()));
                    while (i < lines.length && !lines[i].trim()) {
                        i += 1;
                    }
                    if (i < lines.length && !lines[i].match(marker)) {
                        break;
                    }
                }

                blocks.push(`<${tag}>${items.join('')}</${tag}>`);
                continue;
            }

            // Table: | col | col | with optional separator row
            if (isTableRow(current)) {
                const tableRows = [];
                while (i < lines.length && isTableRow(lines[i])) {
                    tableRows.push(lines[i]);
                    i += 1;
                }
                if (tableRows.length >= 2) {
                    const parseCells = (row) => {
                        return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
                    };
                    let headerRow = parseCells(tableRows[0]);
                    let hasSeparator = isTableSeparator(tableRows[1]);
                    let dataStart = hasSeparator ? 2 : 1;

                    let html = '<table>';
                    if (hasSeparator) {
                        html += '<thead><tr>';
                        headerRow.forEach(cell => { html += `<th>${renderInlineMarkdown(cell)}</th>`; });
                        html += '</tr></thead>';
                    }
                    html += '<tbody>';
                    const bodyStart = hasSeparator ? dataStart : 0;
                    for (let r = bodyStart; r < tableRows.length; r++) {
                        const cells = parseCells(tableRows[r]);
                        html += '<tr>';
                        cells.forEach(cell => { html += `<td>${renderInlineMarkdown(cell)}</td>`; });
                        html += '</tr>';
                    }
                    html += '</tbody></table>';
                    blocks.push(html);
                } else {
                    // Single row - treat as paragraph
                    blocks.push(`<p>${renderInlineMarkdown(tableRows[0])}</p>`);
                }
                continue;
            }

            const paraLines = [];
            while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
                paraLines.push(lines[i].trim());
                i += 1;
            }
            if (paraLines.length) {
                blocks.push(`<p>${paraLines.map((line) => renderInlineMarkdown(line)).join('<br>')}</p>`);
            } else {
                i += 1;
            }
        }

        return blocks.join('');
    }

    function wrapPlainText(text) {
        const normalized = String(text || '').replace(/\r\n?/g, '\n').trim();
        if (!normalized) return '';
        const paragraphs = normalized.split(/\n{2,}/);
        return paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`).join('');
    }

    function markdownToHtml(text) {
        const normalized = String(text || '').replace(/\r\n?/g, '\n');
        if (!normalized.trim()) return '';
        return parseMarkdownBlocks(normalized);
    }

    function findAncestorTag(node, tags) {
        const targetTags = tags || [];
        let current = node && node.nodeType === Node.ELEMENT_NODE ? node : (node ? node.parentNode : null);
        while (current && current.nodeType === Node.ELEMENT_NODE) {
            if (targetTags.includes(current.tagName)) {
                return current;
            }
            current = current.parentNode;
        }
        return null;
    }

    function replaceTextRangeWithNode(textNode, start, end, tagName, textContent) {
        const source = textNode ? (textNode.nodeValue || '') : '';
        if (!textNode || !textNode.parentNode) return false;
        if (!tagName || start < 0 || end <= start || end > source.length) return false;

        const prefix = source.slice(0, start);
        const suffix = source.slice(end);
        const parent = textNode.parentNode;
        const element = document.createElement(tagName);
        element.textContent = textContent;

        const fragment = document.createDocumentFragment();
        if (prefix) fragment.appendChild(document.createTextNode(prefix));
        fragment.appendChild(element);
        if (suffix) fragment.appendChild(document.createTextNode(suffix));

        parent.insertBefore(fragment, textNode);
        parent.removeChild(textNode);

        const selection = window.getSelection();
        if (selection) {
            const range = document.createRange();
            range.setStartAfter(element);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
        }
        return true;
    }

    function isInlineContentValid(text) {
        const value = String(text || '');
        return !!value && value.trim() === value;
    }

    function setCaretToEnd(node) {
        const selection = window.getSelection();
        if (!selection || !node) return;
        const range = document.createRange();
        range.selectNodeContents(node);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    function findSimpleLineContext(editor) {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return null;
        const range = selection.getRangeAt(0);
        if (!range.collapsed) return null;
        const node = range.startContainer;
        if (!node || node.nodeType !== Node.TEXT_NODE) return null;
        if (!node.parentNode || !editor.contains(node)) return null;
        if (findAncestorTag(node, ['A', 'CODE', 'PRE'])) return null;

        let block = node.parentNode;
        while (block && block !== editor && block.nodeType === Node.ELEMENT_NODE) {
            const tag = block.tagName;
            if (['DIV', 'P', 'LI', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(tag)) {
                break;
            }
            block = block.parentNode;
        }

        if (!block || block === editor || block.nodeType !== Node.ELEMENT_NODE) {
            const text = node.nodeValue || '';
            if (range.startOffset !== text.length) return null;
            return { mode: 'text', node, text };
        }

        if (block.childNodes.length !== 1 || block.firstChild !== node) {
            return null;
        }

        const text = node.nodeValue || '';
        if (range.startOffset !== text.length) return null;
        return { mode: 'block', block, node, text };
    }

    function replaceLineContext(context, newNode, placeAfter = false) {
        if (!context || !newNode) return false;
        const oldNode = context.mode === 'block' ? context.block : context.node;
        const parent = oldNode ? oldNode.parentNode : null;
        if (!parent) return false;

        parent.insertBefore(newNode, oldNode);
        parent.removeChild(oldNode);

        if (placeAfter) {
            const nextLine = document.createElement('div');
            nextLine.appendChild(document.createElement('br'));
            if (newNode.nextSibling) {
                parent.insertBefore(nextLine, newNode.nextSibling);
            } else {
                parent.appendChild(nextLine);
            }
            setCaretToEnd(nextLine);
            return true;
        }

        setCaretToEnd(newNode);
        return true;
    }

    function buildListNode(ordered, bodyText) {
        const list = document.createElement(ordered ? 'ol' : 'ul');
        list.innerHTML = renderMarkdownListItem(bodyText.trim());
        return list;
    }

    function tryConvertInlineMarkdownAtSelection(editor, event) {
        if (!editor || !event || event.inputType !== 'insertText') return false;
        const trigger = event.data || '';
        if (!['*', '_', '~', '`', '='].includes(trigger)) return false;

        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return false;
        const range = selection.getRangeAt(0);
        if (!range.collapsed) return false;
        const node = range.startContainer;
        if (!node || node.nodeType !== Node.TEXT_NODE) return false;
        if (findAncestorTag(node, ['A', 'CODE', 'PRE'])) return false;

        const text = node.nodeValue || '';
        const offset = range.startOffset;
        if (offset <= 0 || offset > text.length) return false;

        const before = text.slice(0, offset);

        const strongMatch = before.match(/(\*\*|__)([^\n]+?)\1$/);
        if (strongMatch && isInlineContentValid(strongMatch[2])) {
            const start = before.length - strongMatch[0].length;
            return replaceTextRangeWithNode(node, start, offset, 'strong', strongMatch[2]);
        }

        const strikeMatch = before.match(/~~([^\n]+?)~~$/);
        if (strikeMatch && isInlineContentValid(strikeMatch[1])) {
            const start = before.length - strikeMatch[0].length;
            return replaceTextRangeWithNode(node, start, offset, 'del', strikeMatch[1]);
        }

        const codeMatch = before.match(/`([^`\n]+?)`$/);
        if (codeMatch && isInlineContentValid(codeMatch[1])) {
            const start = before.length - codeMatch[0].length;
            return replaceTextRangeWithNode(node, start, offset, 'code', codeMatch[1]);
        }

        const italicStarMatch = before.match(/(^|[^*])\*([^*\n]+?)\*$/);
        if (italicStarMatch && isInlineContentValid(italicStarMatch[2])) {
            const prefixLen = italicStarMatch[1] ? italicStarMatch[1].length : 0;
            const start = before.length - italicStarMatch[0].length + prefixLen;
            return replaceTextRangeWithNode(node, start, offset, 'em', italicStarMatch[2]);
        }

        const italicUnderscoreMatch = before.match(/(^|[^_])_([^_\n]+?)_$/);
        if (italicUnderscoreMatch && isInlineContentValid(italicUnderscoreMatch[2])) {
            const prefixLen = italicUnderscoreMatch[1] ? italicUnderscoreMatch[1].length : 0;
            const start = before.length - italicUnderscoreMatch[0].length + prefixLen;
            return replaceTextRangeWithNode(node, start, offset, 'em', italicUnderscoreMatch[2]);
        }

        // ==highlight== -> <mark>
        const highlightMatch = before.match(/==([^=\n]+?)==$/);
        if (highlightMatch && isInlineContentValid(highlightMatch[1])) {
            const start = before.length - highlightMatch[0].length;
            return replaceTextRangeWithNode(node, start, offset, 'mark', highlightMatch[1]);
        }

        return false;
    }

    function tryConvertBlockMarkdownAtSelection(editor, event) {
        if (!editor || !event) return false;
        if (!['insertText', 'insertParagraph', 'insertLineBreak'].includes(event.inputType)) return false;

        const context = findSimpleLineContext(editor);
        if (!context) return false;
        const raw = context.text || '';
        if (!raw.trim()) return false;

        const headingMatch = raw.match(/^\s{0,3}(#{1,6})(?:\s+|(?=\S))(.+?)\s*#*\s*$/);
        if (headingMatch) {
            const heading = document.createElement(`h${Math.min(6, headingMatch[1].length)}`);
            heading.innerHTML = renderInlineMarkdown(headingMatch[2].trim());
            return replaceLineContext(context, heading);
        }

        const quoteMatch = raw.match(/^\s{0,3}>\s?(.*)$/);
        if (quoteMatch && quoteMatch[1].trim()) {
            const blockquote = document.createElement('blockquote');
            blockquote.innerHTML = renderInlineMarkdown(quoteMatch[1].trim());
            return replaceLineContext(context, blockquote);
        }

        // Check for task/checkbox before bullet list: - [ ] text, - [x] text, - [] text
        const checkboxMatch = raw.match(/^\s{0,3}[-*+]\s+\[( |x|X)?\]\s*(.*)$/);
        if (checkboxMatch) {
            const checked = (checkboxMatch[1] || '').toLowerCase() === 'x';
            const body = (checkboxMatch[2] || '').trim();
            const span = document.createElement('span');
            span.className = 'note-inline-checkbox' + (checked ? ' checked' : '');
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = checked;
            span.appendChild(cb);
            span.appendChild(document.createTextNode(' ' + body));
            return replaceLineContext(context, span);
        }

        const unorderedMatch = raw.match(/^\s{0,3}[-*+]\s+(.*)$/);
        if (unorderedMatch && unorderedMatch[1].trim()) {
            const list = buildListNode(false, unorderedMatch[1]);
            return replaceLineContext(context, list);
        }

        const orderedMatch = raw.match(/^\s{0,3}\d+[.)]\s+(.*)$/);
        if (orderedMatch && orderedMatch[1].trim()) {
            const list = buildListNode(true, orderedMatch[1]);
            return replaceLineContext(context, list);
        }

        // ![alt](url) -> image
        const imageMatch = raw.match(/^\s{0,3}!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)\s*$/i);
        if (imageMatch) {
            const wrapper = document.createElement('div');
            wrapper.className = 'note-image-wrapper';
            wrapper.contentEditable = 'false';
            const img = document.createElement('img');
            img.className = 'note-embedded-image';
            img.alt = imageMatch[1] || 'image';
            img.src = imageMatch[2];
            img.style.maxWidth = '100%';
            img.draggable = false;
            wrapper.appendChild(img);
            return replaceLineContext(context, wrapper, true);
        }

        if (/^\s{0,3}(?:[-*_]\s*){3,}$/.test(raw)) {
            const hr = document.createElement('hr');
            return replaceLineContext(context, hr, true);
        }

        if (/^\s{0,3}```\s*$/.test(raw)) {
            const pre = document.createElement('pre');
            const code = document.createElement('code');
            const textNode = document.createTextNode('');
            code.appendChild(textNode);
            pre.appendChild(code);
            const converted = replaceLineContext(context, pre);
            if (!converted) return false;
            const selection = window.getSelection();
            if (selection) {
                const range = document.createRange();
                range.setStart(textNode, 0);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
            }
            return true;
        }

        return false;
    }

    function renderNoteContentForEditor(rawHtml) {
        const incoming = String(rawHtml || '');
        if (!incoming.trim()) return '';
        if (hasSubstantiveHtml(incoming)) return incoming;
        const plain = htmlToPlainText(incoming);
        if (!plain) return '';
        if (looksLikeMarkdown(plain)) {
            return markdownToHtml(plain);
        }
        return wrapPlainText(plain);
    }

    function normalizeNoteEditorHtml(rawHtml) {
        const incoming = String(rawHtml || '');
        if (!incoming.trim()) return '';
        if (hasSubstantiveHtml(incoming)) return incoming.trim();
        const plain = htmlToPlainText(incoming);
        if (!plain) return '';
        if (looksLikeMarkdown(plain)) {
            return markdownToHtml(plain).trim();
        }
        return wrapPlainText(plain).trim();
    }

    function shouldConvertPastedMarkdown(text) {
        return looksLikeMarkdown(String(text || ''));
    }

    // ── HTML to Markdown converter (for export) ──────────────────────

    function noteHtmlToMarkdown(html) {
        if (!html) return '';
        const container = document.createElement('div');
        container.innerHTML = html;
        return convertNodeToMarkdown(container).replace(/\n{3,}/g, '\n\n').trim();
    }

    function convertNodeToMarkdown(node) {
        if (!node) return '';
        if (node.nodeType === Node.TEXT_NODE) {
            return (node.nodeValue || '').replace(/\u00a0/g, ' ');
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return '';
        const tag = node.tagName.toLowerCase();

        // Get inline text for inline elements
        const inlineChildren = () => {
            let result = '';
            for (const child of node.childNodes) {
                result += convertNodeToMarkdown(child);
            }
            return result;
        };

        // Block children
        const blockChildren = () => {
            let result = '';
            for (const child of node.childNodes) {
                result += convertNodeToMarkdown(child);
            }
            return result;
        };

        switch (tag) {
            case 'strong':
            case 'b':
                return `**${inlineChildren()}**`;
            case 'em':
            case 'i':
                return `*${inlineChildren()}*`;
            case 'del':
            case 's':
            case 'strike':
                return `~~${inlineChildren()}~~`;
            case 'mark':
                return `==${inlineChildren()}==`;
            case 'code':
                if (node.parentElement && node.parentElement.tagName.toLowerCase() === 'pre') {
                    return node.textContent || '';
                }
                return `\`${node.textContent || ''}\``;
            case 'u':
                return inlineChildren();
            case 'a': {
                const href = node.getAttribute('href') || '';
                const text = inlineChildren();
                if (node.classList.contains('note-link')) {
                    return `[[${text}]]`;
                }
                if (href && href !== '#') {
                    return `[${text}](${href})`;
                }
                return text;
            }
            case 'img': {
                const src = node.getAttribute('src') || '';
                const alt = node.getAttribute('alt') || 'image';
                return `![${alt}](${src})`;
            }
            case 'br':
                return '\n';
            case 'hr':
                return '\n---\n';
            case 'h1':
                return `\n# ${inlineChildren()}\n`;
            case 'h2':
                return `\n## ${inlineChildren()}\n`;
            case 'h3':
                return `\n### ${inlineChildren()}\n`;
            case 'h4':
                return `\n#### ${inlineChildren()}\n`;
            case 'h5':
                return `\n##### ${inlineChildren()}\n`;
            case 'h6':
                return `\n###### ${inlineChildren()}\n`;
            case 'p':
            case 'div':
                return `\n${inlineChildren()}\n`;
            case 'blockquote': {
                const content = blockChildren().trim();
                return '\n' + content.split('\n').map(line => `> ${line}`).join('\n') + '\n';
            }
            case 'pre': {
                const codeEl = node.querySelector('code');
                const codeText = codeEl ? (codeEl.textContent || '') : (node.textContent || '');
                return `\n\`\`\`\n${codeText}\n\`\`\`\n`;
            }
            case 'ul': {
                let result = '\n';
                const items = node.querySelectorAll(':scope > li');
                items.forEach(li => {
                    const checkbox = li.querySelector('.note-inline-checkbox input[type="checkbox"]');
                    const content = convertLiContent(li);
                    if (checkbox) {
                        const checked = checkbox.checked ? 'x' : ' ';
                        result += `- [${checked}] ${content}\n`;
                    } else {
                        result += `- ${content}\n`;
                    }
                });
                return result;
            }
            case 'ol': {
                let result = '\n';
                const items = node.querySelectorAll(':scope > li');
                items.forEach((li, i) => {
                    const content = convertLiContent(li);
                    result += `${i + 1}. ${content}\n`;
                });
                return result;
            }
            case 'li':
                return inlineChildren();
            case 'table':
                return convertTableToMarkdown(node);
            case 'span': {
                if (node.classList.contains('note-inline-checkbox')) {
                    const checkbox = node.querySelector('input[type="checkbox"]');
                    const checked = checkbox && checkbox.checked ? 'x' : ' ';
                    const text = inlineChildren().replace(/^\s*/, '');
                    return `- [${checked}] ${text}`;
                }
                return inlineChildren();
            }
            default:
                return blockChildren();
        }
    }

    function convertLiContent(li) {
        let result = '';
        for (const child of li.childNodes) {
            if (child.nodeType === Node.ELEMENT_NODE) {
                const tag = child.tagName.toLowerCase();
                if (tag === 'ul' || tag === 'ol') continue; // Skip nested lists in direct content
            }
            result += convertNodeToMarkdown(child);
        }
        return result.trim();
    }

    function convertTableToMarkdown(table) {
        const rows = table.querySelectorAll('tr');
        if (!rows.length) return '';

        let md = '\n';
        const allRows = [];
        rows.forEach(row => {
            const cells = [];
            row.querySelectorAll('th, td').forEach(cell => {
                cells.push((cell.textContent || '').trim());
            });
            allRows.push(cells);
        });

        if (!allRows.length) return '';

        // Calculate column widths
        const colCount = Math.max(...allRows.map(r => r.length));

        // First row (header or just data)
        const firstRow = allRows[0] || [];
        md += '| ' + firstRow.map(c => c).join(' | ') + ' |\n';

        // Separator
        md += '| ' + Array.from({ length: colCount }, () => '---').join(' | ') + ' |\n';

        // Data rows
        for (let r = 1; r < allRows.length; r++) {
            md += '| ' + allRows[r].map(c => c).join(' | ') + ' |\n';
        }
        return md;
    }


    window.NoteMarkdown = {
        markdownToHtml,
        normalizeNoteEditorHtml,
        noteHtmlToMarkdown,
        renderNoteContentForEditor,
        shouldConvertPastedMarkdown,
        tryConvertInlineMarkdownAtSelection,
        tryConvertBlockMarkdownAtSelection
    };
})();
