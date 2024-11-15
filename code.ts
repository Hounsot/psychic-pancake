function getSelectedAutoLayoutInfo() {
    const selection = figma.currentPage.selection
    if (selection.length === 1) {
        const selectedNode = selection[0]
        // Check if the selected node has AutoLayout properties
        if (selectedNode.type === 'FRAME' && selectedNode.layoutMode) {
            return {
                isSelected: true,
                name: selectedNode.name,
                width: selectedNode.width,
                height: selectedNode.height,
            }
        }
    }
    return { isSelected: false }
}
figma.showUI(__html__, {
    width: 460,
    height: 660,
    title: 'Конфигуратор рассылки',
})
let autoLayoutInfo = getSelectedAutoLayoutInfo()
figma.ui.postMessage({
    type: 'auto-layout-check',
    ...autoLayoutInfo, // Spread the returned object properties into the message
})
figma.on('selectionchange', () => {
    let autoLayoutInfo = getSelectedAutoLayoutInfo()
    figma.ui.postMessage({
        type: 'auto-layout-check',
        ...autoLayoutInfo, // Spread the returned object properties into the message
    })
})
async function convertAutoLayoutToTable(frame: FrameNode) {
    // Check if the node is AutoLayout
    if (!frame.layoutMode) {
        figma.notify('Selected node is not an AutoLayout frame')
        return
    }
    // Extract properties of the frame
    const styles = extractStyles(frame)
    let html = `<body style="width: 100%; display: flex; flex-direction: column; align-items: center; background-color: #D3D3D3;"><table align="center" border="0" cellspacing="0" cellpadding="0" style="width: 100% !important; max-width: 600px; table-layout: fixed; border-collapse: collapse; ${styles}">\n`

    // Recursively process children (nested AutoLayouts or other nodes)
    for (const child of frame.children) {
        html += await processChildNode(child) // Pass `false` to indicate it's not top-level
    }

    html += `</table></body>`
    return html
}

function extractStyles(node: SceneNode): string {
    const styles = []
    styles.push('box-sizing: border-box;')
    // Extract width and height for frames and auto layouts
    if (node.type === 'FRAME' || node.type === 'GROUP' || node.type === 'INSTANCE' || node.type === 'RECTANGLE') {
        if (node.width) styles.push(`width:${node.width}px;`)
        if (node.height) styles.push(`height:${node.height}px;`)
        // Extract padding (from AutoLayout settings)
        if ('paddingLeft' in node) styles.push(`padding-left:${node.paddingLeft}px;`)
        if ('paddingRight' in node) styles.push(`padding-right:${node.paddingRight}px;`)
        if ('paddingTop' in node) styles.push(`padding-top:${node.paddingTop}px;`)
        if ('paddingBottom' in node) styles.push(`padding-bottom:${node.paddingBottom}px;`)
    }

    // Extract background color (fill) if available
    if (node.fills && node.fills.length > 0 && node.fills[0].type === 'SOLID' && node.type != 'TEXT') {
        const fill = node.fills[0] as SolidPaint
        const { r, g, b } = fill.color
        const alpha = fill.opacity !== undefined ? fill.opacity : 1
        const backgroundColor = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`
        styles.push(`background-color: ${backgroundColor};`)
    }

    // Extract text styles for text nodes
    if (node.type === 'TEXT') {
        const textNode = node as TextNode

        // Extract font-family (e.g., Arial, sans-serif)
        styles.push(`font-family: ${textNode.fontName.family}, sans-serif;`)

        // Extract font-weight (normal, bold, etc.)
        styles.push(`font-weight: ${textNode.fontName.style};`)

        // Extract font-size
        styles.push(`font-size: ${textNode.fontSize}px;`)

        // Extract line-height (Figma uses percentage-based line heights)
        if (textNode.lineHeight && textNode.lineHeight.unit === 'PIXELS') {
            styles.push(`line-height: ${textNode.lineHeight.value}px;`)
        } else if (textNode.lineHeight && textNode.lineHeight.unit === 'PERCENT') {
            const calculatedLineHeight = (textNode.lineHeight.value / 100) * textNode.fontSize
            styles.push(`line-height: ${calculatedLineHeight}px;`)
        }

        // Extract text-align (if present)
        if ('textAlignHorizontal' in textNode) {
            if (textNode.textAlignHorizontal === 'CENTER') {
                styles.push('text-align: center;')
            } else if (textNode.textAlignHorizontal === 'LEFT') {
                styles.push('text-align: left;')
            } else if (textNode.textAlignHorizontal === 'RIGHT') {
                styles.push('text-align: right;')
            }
        }

        // Extract color (Figma uses RGBA)
        if (textNode.fills.length > 0 && textNode.fills[0].type === 'SOLID') {
            const fill = textNode.fills[0] as SolidPaint
            const { r, g, b } = fill.color
            const alpha = fill.opacity !== undefined ? fill.opacity : 1
            const color = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`
            styles.push(`color: ${color};`)
        }
    }

    return styles.join(' ')
}
function findMaxWidth(node: FrameNode): number {
    let maxWidth = 0

    // Check if the node has children
    if (node.children.length > 0) {
        if (node.layoutMode === 'HORIZONTAL') {
            // In HORIZONTAL mode, the total width is the sum of all child widths
            for (const child of node.children) {
                if ('width' in child) {
                    maxWidth = Math.max(maxWidth, child.width)
                }
                // Recursively check for child nodes
                if (child.type === 'FRAME' || child.type === 'INSTANCE' || child.type === 'GROUP') {
                    maxWidth = Math.max(maxWidth, findMaxWidth(child as FrameNode))
                }
            }
        } else if (node.layoutMode === 'VERTICAL') {
            // In VERTICAL mode, the max width is the largest width of any child
            for (const child of node.children) {
                if ('width' in child) {
                    maxWidth = Math.max(maxWidth, child.width)
                }
                // Recursively check for child nodes
                if (child.type === 'FRAME' || child.type === 'INSTANCE' || child.type === 'GROUP') {
                    maxWidth = Math.max(maxWidth, findMaxWidth(child as FrameNode))
                }
            }
        }
    } else {
        // If there are no children, the width is just the node's own width
        maxWidth = node.width
    }

    return maxWidth
}
function getWidthProperty(node: SceneNode): string {
    // For AutoLayout nodes (Frame or Instance), check if width is set to "fill"
    if ((node.type === 'FRAME' || node.type === 'INSTANCE') && node.layoutMode) {
        // In AutoLayout, check if the width is set to fill container
        if (node.primaryAxisSizingMode === 'AUTO') {
            return '100%' // Fill container behavior
        }
    } else if (node.type === 'TEXT' && node.layoutGrow === 1) {
        return '100%' // Fill container behavior
    }
    // Default behavior for other nodes
    return `${node.width}px` // Return width in pixels if not set to fill
}
async function processChildNode(node: SceneNode): Promise<string> {
    let html = ''
    let primaryAxisAlignItems = node.primaryAxisAlignItems === 'MIN' && node.counterAxisAlignItems === 'CENTER' && node.layoutMode === 'VERTICAL' ? `align="center"` : `:)`
    let maxWidth = 0
    switch (node.type) {
        case 'INSTANCE':
            maxWidth = findMaxWidth(node)
            if (node.layoutMode === 'HORIZONTAL' && node.name != 'Image Frame') {
                html += `<tr id="${node.name}" width=${node.width} height=${node.height}><td id="${node.name}" width=${node.width} height=${node.height} ${primaryAxisAlignItems}>`
                for (const child of node.children) {
                    html += await processChildNode(child)
                }
                html += `</td></tr>`
            } else if (node.layoutMode === 'VERTICAL' && node.name != 'Image Frame') {
                html += `<tr id="${node.name}" width=${node.width} height=${node.height}><td id="${node.name}" width=${node.width} height=${node.height} ${primaryAxisAlignItems}><table id="${node.name}" style="border-collapse: collapse;
table-layout: fixed; width: ${maxWidth}px; height: auto">`
                for (const child of node.children) {
                    html += await processChildNode(child)
                }
                html += `</table></td></tr>`
            } else if (node.name === 'Image Frame') {
                html += `<img src="https://parametr.space/media/cache/homepage_about_image_xxl/uploads/47/kuvekino_04_1713956437.jpg" width="${node.width}" height="${node.height}">`
            }
            break
        case 'FRAME':
            maxWidth = findMaxWidth(node)
            if (node.parent.layoutMode === 'HORIZONTAL') {
                if (node.layoutMode === 'HORIZONTAL' && node.name != 'Image Frame') {
                    html += `<div><tr id="${node.name}"><td id="${node.name}" ${primaryAxisAlignItems}>`
                    for (const child of node.children) {
                        html += await processChildNode(child)
                    }
                    html += `</td></tr></div>`
                } else if (node.layoutMode === 'VERTICAL' && node.name != 'Image Frame') {
                    html += `<div><td id="${node.name}, ${node.parent.layoutMode}" style="vertical-align: top; ${extractStyles(node)}" ${primaryAxisAlignItems}><table id="${
                        node.name
                    }" style="vertical-align: top; border-collapse: collapse;
table-layout: fixed; width: ${maxWidth}px; height: auto">`
                    for (const child of node.children) {
                        html += await processChildNode(child)
                    }
                    html += `</table></td></div>`
                } else if (node.name === 'Image Frame') {
                    if (node.parent.layoutMode === 'HORIZONTAL') {
                        html += `<td width="${node.width}" height="${node.height}" style="display: inline-block;"><img src="https://parametr.space/media/cache/homepage_about_image_xxl/uploads/47/kuvekino_04_1713956437.jpg" width="${node.width}" height="${node.height}"></td>`
                    } else {
                        html += `<td width="${node.width}" height="${node.height}"><img src="https://parametr.space/media/cache/homepage_about_image_xxl/uploads/47/kuvekino_04_1713956437.jpg" width="${node.width}" height="${node.height}"></td>`
                    }
                }
            } else {
                if (node.layoutMode === 'HORIZONTAL' && node.name != 'Image Frame') {
                    html += `<tr id="${node.name}">`
                    for (const child of node.children) {
                        html += await processChildNode(child)
                    }
                    html += `</tr>`
                } else if (node.layoutMode === 'VERTICAL' && node.name != 'Image Frame') {
                    html += `<tr id="${node.name}" style="vertical-align: top;"><td id="${node.name}" style="vertical-align: top; ${extractStyles(node)}" ${primaryAxisAlignItems}><table id="${
                        node.name
                    }" style="vertical-align: top; border-collapse: collapse;
table-layout: fixed; width: ${maxWidth}px; height: auto">`
                    for (const child of node.children) {
                        html += await processChildNode(child)
                    }
                    html += `</table></td></tr>`
                } else if (node.name === 'Image Frame') {
                    html += `<img src="https://parametr.space/media/cache/homepage_about_image_xxl/uploads/47/kuvekino_04_1713956437.jpg" width="${node.width}" height="${node.height}">`
                }
            }
            break
        case 'TEXT':
            let widthValue = getWidthProperty(node)
            if (node.parent.layoutMode === 'HORIZONTAL') {
                let parentLayout = node.parent.layoutMode === 'HORIZONTAL' ? `display: inline-block;` : ``
                html += `<td width="${node.width}" height=${node.height} style="padding: 0; ${parentLayout} ${extractStyles(node)}">${await getTextContent(node)}</td>\n`
            } else {
                html += `<tr id="${'AAAAAAAAAAAAAAAAAAA'}" width="${node.width}" height=${node.height}><td style="vertical-align: top;padding: 0; ${extractStyles(node)}">${await getTextContent(
                    node,
                )}</td></tr>\n`
            }
            break
        case 'RECTANGLE':
            if (node.parent.layoutMode === 'HORIZONTAL') {
                html += `<td id="${node.name}, ${node.parent.layoutMode}, ${node.parent.name}" width=${node.width} height=${node.height}></td>`
            } else {
                html += `<tr width=${node.width} height=${node.height}></tr>`
            }
            break
    }
    return html
}
// Helper function to extract text content from a TextNode
async function getTextContent(textNode: TextNode): Promise<string> {
    const content = textNode.characters
    // Replace Figma line breaks (newlines) with <br> tags for HTML format
    return content.replace(/\n/g, '<br>')
}
figma.ui.onmessage = async msg => {
    if (msg.type === 'convert') {
        const selectedNodes = figma.currentPage.selection
        if (selectedNodes.length === 0) {
            figma.notify('Please select a frame with AutoLayout.')
            return
        }
        const selectedFrame = selectedNodes[0] as FrameNode
        const html = await convertAutoLayoutToTable(selectedFrame)
        figma.ui.postMessage({ type: 'copy-html', html })
    }
}
