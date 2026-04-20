import { checkCraftingRecipe } from './recipes';

export type InventoryItem = { type: string, count: number } | null;

export const inventory: InventoryItem[] = new Array(59).fill(null);
export let selectedSlotIndex = 0;
export let craftingMode: '2x2' | '3x3' = '2x2';

export function setCraftingMode(mode: '2x2' | '3x3') {
    craftingMode = mode;
    refreshCrafting();
}

export function setSelectedSlot(index: number) {
    selectedSlotIndex = index;
    renderInventoryBar();
}

export function addItem(type: string, count: number = 1): number {
    // try to stack first
    for (let i = 0; i < inventory.length; i++) {
        const item = inventory[i];
        if (item && item.type === type && item.count < 64) {
            const space = 64 - item.count;
            if (count <= space) {
                item.count += count;
                updateInventoryUI();
                return 0; // completely added
            } else {
                item.count = 64;
                count -= space;
            }
        }
    }
    // place in empty slot
    for (let i = 0; i < inventory.length; i++) {
        if (!inventory[i]) {
            const addCount = Math.min(64, count);
            inventory[i] = { type, count: addCount };
            count -= addCount;
            if (count <= 0) {
                updateInventoryUI();
                return 0;
            }
        }
    }
    updateInventoryUI();
    return count; // returns remaining un-added amount
}

export function removeItem(index: number, count: number = 1): boolean {
    const item = inventory[index];
    if (item && item.count >= count) {
        item.count -= count;
        if (item.count <= 0) {
            inventory[index] = null;
        }
        updateInventoryUI();
        return true;
    }
    return false;
}



let draggedSlotIndex: number | null = null;
let lastAutoPlaceSlot: number | null = null;

function handleDragStart(e: DragEvent, index: number) {
    if (!inventory[index]) {
        e.preventDefault();
        return;
    }
    draggedSlotIndex = index;
    lastAutoPlaceSlot = index;
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData('text/plain', index.toString()); // Required for Firefox and some browsers to start drag
}

export function refreshCrafting(skipRender = false) {
    const gridTypes: (string | null)[] = [];
    let cols = 2;
    if (craftingMode === '2x2') {
        gridTypes.push(inventory[45]?.type || null, inventory[46]?.type || null);
        gridTypes.push(inventory[48]?.type || null, inventory[49]?.type || null);
    } else {
        cols = 3;
        gridTypes.push(inventory[45]?.type || null, inventory[46]?.type || null, inventory[47]?.type || null);
        gridTypes.push(inventory[48]?.type || null, inventory[49]?.type || null, inventory[50]?.type || null);
        gridTypes.push(inventory[51]?.type || null, inventory[52]?.type || null, inventory[53]?.type || null);
    }
    
    const result = checkCraftingRecipe(gridTypes, cols);
    inventory[54] = result ? { type: result.type, count: result.count } : null;
    if (!skipRender) renderFullInventory();
}

function handleDragEnd() {
    draggedSlotIndex = null;
    lastAutoPlaceSlot = null;
}

function handleDragEnter(e: DragEvent, targetIndex: number, el: HTMLElement) {
    e.preventDefault();
    el.classList.add('drag-over');

    if (draggedSlotIndex !== null && draggedSlotIndex !== targetIndex) {
        const isTargetCrafting = targetIndex >= 45 && targetIndex <= 53;
        const source = inventory[draggedSlotIndex];
        let target = inventory[targetIndex];
        
        if (isTargetCrafting && source && source.count > 1 && lastAutoPlaceSlot !== targetIndex) {
            // Only place into empty slots or slots of the same item
            if (!target || (target.type === source.type && target.count < 64)) {
                lastAutoPlaceSlot = targetIndex;
                if (!target) {
                    inventory[targetIndex] = { type: source.type, count: 1 };
                } else {
                    target.count += 1;
                }
                source.count -= 1;
                
                updateSlotDOM(el, targetIndex);
                
                const sourceEl = document.querySelector(`.slot[data-index="${draggedSlotIndex}"]`) as HTMLElement;
                if (sourceEl) updateSlotDOM(sourceEl, draggedSlotIndex);
                
                refreshCrafting(true);
                const cResult = document.getElementById('crafting-result');
                if (cResult) { 
                    cResult.innerHTML = ''; 
                    renderSlot(cResult, 54, false); 
                }
            }
        }
    }
}

function handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
}

function handleDrop(e: DragEvent, targetIndex: number) {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.classList.remove('drag-over');

    if (draggedSlotIndex === null) return;
    if (targetIndex === 54) return; // Cannot drop directly into output slot

    const sourceOpt = inventory[draggedSlotIndex];
    if (targetIndex >= 55 && targetIndex <= 58 && sourceOpt) {
        const isHelmet = targetIndex === 55 && sourceOpt.type.endsWith('_helmet');
        const isChest = targetIndex === 56 && sourceOpt.type.endsWith('_chestplate');
        const isLegs = targetIndex === 57 && sourceOpt.type.endsWith('_leggings');
        const isBoots = targetIndex === 58 && sourceOpt.type.endsWith('_boots');
        if (!isHelmet && !isChest && !isLegs && !isBoots) return;
    }

    if (draggedSlotIndex === 54 && targetIndex !== 54) {
         const resultItem = inventory[54];
         if (!resultItem) return;
         
         const target = inventory[targetIndex];
         if (target && target.type !== resultItem.type) return; 
         if (target && target.count + resultItem.count > 64) return; 
         
         if (target) {
            target.count += resultItem.count;
         } else {
            inventory[targetIndex] = resultItem;
         }
         
         const gridIndices = craftingMode === '2x2' ? [45,46, 48,49] : [45,46,47, 48,49,50, 51,52,53];
         for (const i of gridIndices) {
             if (inventory[i]) {
                 inventory[i]!.count -= 1;
                 if (inventory[i]!.count <= 0) inventory[i] = null;
             }
         }
         
         inventory[54] = null;
         updateInventoryUI();
         refreshCrafting();
         draggedSlotIndex = null;
         return;
    }

    if (draggedSlotIndex !== targetIndex) {
        const source = inventory[draggedSlotIndex];
        let target = inventory[targetIndex];
        
        if (source) {
            let amountToMove = source.count;
            if (e.shiftKey) amountToMove = 1;
            else if (e.ctrlKey || e.metaKey) amountToMove = Math.ceil(source.count / 2);
            
            // Cannot move more than exists
            amountToMove = Math.min(amountToMove, source.count);

            if (!target) {
                // Moving into empty slot
                inventory[targetIndex] = { type: source.type, count: amountToMove };
                source.count -= amountToMove;
                if (source.count <= 0) inventory[draggedSlotIndex] = null;
            } else if (source.type === target.type) {
                // Merging with same type
                const space = 64 - target.count;
                amountToMove = Math.min(space, amountToMove);
                target.count += amountToMove;
                source.count -= amountToMove;
                if (source.count <= 0) inventory[draggedSlotIndex] = null;
            } else {
                 // Different types, swap ONLY if moving full stack
                 if (amountToMove === source.count) {
                     inventory[targetIndex] = source;
                     inventory[draggedSlotIndex] = target;
                 }
            }
        }
        updateInventoryUI();
        refreshCrafting();
    }
    draggedSlotIndex = null;
    lastAutoPlaceSlot = null;
}

export function updateSlotDOM(el: HTMLElement, index: number) {
    el.innerHTML = '';
    const item = inventory[index];
    if (item) {
        el.draggable = true;
        
        const isFlat = item.type === 'stick' || (item.type.includes('_') && item.type !== 'crafting_table');
        if (isFlat) {
            const icon = document.createElement('div');
            icon.className = `icon-2d item-${item.type}`;
            el.appendChild(icon);
        } else {
            const icon = document.createElement('div');
            icon.className = `item-icon block-${item.type}`;
            ['top', 'right', 'front'].forEach(faceClass => {
               const f = document.createElement('div');
               f.className = `face ${faceClass}`;
               icon.appendChild(f);
            });
            el.appendChild(icon);
        }
        
        if (item.count > 1) {
            const count = document.createElement('span');
            count.className = 'count';
            count.innerText = item.count.toString();
            el.appendChild(count);
        }
    } else {
        el.draggable = false;
    }
}

export function renderSlot(container: HTMLElement, index: number, isBar: boolean) {
    const el = document.createElement('div');
    el.className = 'slot' + (isBar && index === selectedSlotIndex ? ' active' : '');
    el.dataset.index = index.toString();
    
    // Drag handlers
    el.addEventListener('dragstart', (e) => handleDragStart(e, index));
    el.addEventListener('dragover', handleDragOver);
    el.addEventListener('drop', (e) => handleDrop(e, index));
    el.addEventListener('dragenter', (e) => handleDragEnter(e, index, el));
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('dragend', handleDragEnd);
    
    updateSlotDOM(el, index);
    container.appendChild(el);
}

export function updateInventoryUI() {
    renderInventoryBar();
    renderFullInventory();
}

export function renderInventoryBar() {
    const bar = document.getElementById('inventory-bar');
    if (!bar) return;
    bar.innerHTML = '';
    // hotbar is indices 0-8
    for(let i=0; i<9; i++) {
        renderSlot(bar, i, true);
    }
}

export function renderFullInventory() {
    const grid = document.getElementById('full-inventory-grid');
    if (!grid) return;
    grid.innerHTML = '';
    
    // Inventory main 9-44
    for(let i=9; i<45; i++) {
        renderSlot(grid, i, false);
    }
    // Add hotbar at the bottom of the grid
    for(let i=0; i<9; i++) {
        renderSlot(grid, i, false);
    }
    
    // Crafting
    const cGrid = document.getElementById('crafting-grid');
    if (cGrid) {
        cGrid.innerHTML = '';
        cGrid.className = `grid-${craftingMode}`;
        
        const indices = craftingMode === '2x2' ? [45,46, 48,49] : [45,46,47, 48,49,50, 51,52,53];
        for (const i of indices) {
            renderSlot(cGrid, i, false);
        }
    }
    
    const cResult = document.getElementById('crafting-result');
    if (cResult) {
        cResult.innerHTML = '';
        renderSlot(cResult, 54, false);
    }
    
    // Armor
    const aGrid = document.getElementById('armor-grid');
    if (aGrid) {
        aGrid.innerHTML = '';
        for (let i = 55; i <= 58; i++) {
            renderSlot(aGrid, i, false);
        }
    }
}

export function initInventory() {
    updateInventoryUI();
}

export function setInventoryData(data: any[]) {
    for(let i=0; i<60; i++) {
        if (data[i]) inventory[i] = { type: data[i].type, count: data[i].count };
        else inventory[i] = null;
    }
    updateInventoryUI();
}
