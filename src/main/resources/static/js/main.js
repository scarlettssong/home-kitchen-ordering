const privateMode = document.documentElement.dataset.private === 'true';
const registrationOpen = document.documentElement.dataset.registrationOpen === 'true';
const orderManagement = document.documentElement.dataset.orderManagement === 'true';
const publicAvatar = document.documentElement.dataset.publicAvatar === 'true';
const language = document.documentElement.lang;
const text = (chinese, english) => language === 'en-US' ? english : chinese;

const byId = id => document.getElementById(id);
const kitchenAvatar = byId('kitchen-avatar');
const defaultKitchenAvatar = '/images/kitchen-avatar.jpg';
const maxPerDish = 3;
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
byId('view-menu').querySelector('[data-category="Thai"]').hidden = !orderManagement;
const categories = new Map([...document.querySelectorAll('[data-category]')]
    .filter(button => !button.hidden)
    .map(button => [button.dataset.category, button]));
const subcategories = new Map([
    ['Staple', text('主食', 'Staples')], ['Vegetables', text('蔬菜', 'Vegetables')],
    ['Beef', text('牛肉', 'Beef')], ['Chicken', text('鸡肉', 'Chicken')], ['Pork', text('猪肉', 'Pork')]
]);
const subcategoryFilters = byId('subcategory-filters');
const defaultCategory = categories.keys().next().value;
const tabs = document.querySelectorAll('[data-view]');
const views = [...document.querySelectorAll('main[id]')];
const defaultView = 'view-menu';
const dialog = byId('dish-modal');
const recipeBackdrop = byId('recipe-backdrop');
const orderTime = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' });
const recipeSplit = matchMedia('(min-width: 850px)');
const mobileLayout = matchMedia('(max-width: 699px)');
const cartButton = byId('cart-button');
const app = byId('app-wrapper');
const cart = new Map();
const dishPhotoVersions = new Map();
const statusLabels = { PLACED: text('已下单', 'Placed'), PREPARING: text('制作中', 'Preparing'), COMPLETED: text('已完成', 'Completed') };
const legacyDemoNames = new Map(Object.entries({
    姜葱香米饭: 'Ginger Scallion Rice',
    芝麻蔬菜煎饺: 'Sesame Garden Dumplings',
    番茄罗勒烤吐司: 'Tomato Basil Toast',
    味噌蘑菇饭团: 'Miso Mushroom Onigiri',
    蜂蜜燕麦布丁: 'Honey Oat Pudding',
    柑橘云朵蛋糕: 'Citrus Cloud Cake'
}));
const nextStatus = { PLACED: 'PREPARING', PREPARING: 'COMPLETED' };

let dishes = [];
let currentCategory = defaultCategory;
let currentSubcategory = '';
let submitting = false;
let session;
let recipeDish;
let recipeMenuPosition;
let desktopBackdropStart = false;
let touchBackdropStart;
let backdropTap = false;
let cartDrag;
let suppressCartClick = false;
let registering = false;
let returnToCart = false;
let toastTimer;

const isAdmin = () => session?.user?.role === 'ADMIN';

function dishPhotoPath(dish) {
    const path = dish?.imagePath;
    const version = dishPhotoVersions.get(dish?.id);
    if (!path || !version) return path;
    return `${path}${path.includes('?') ? '&' : '?'}v=${version}`;
}

function element(tag, className, content) {
    const node = document.createElement(tag);
    node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
}

function button(className, text, onClick) {
    const node = element('button', className, text);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
}

async function request(path, options = {}) {
    const headers = new Headers(options.headers);
    if (options.method && options.method !== 'GET' && session?.csrfToken) {
        headers.set(session.csrfHeader, session.csrfToken);
    }
    const response = await fetch(path, { ...options, headers });
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const hints = { 401: text('请检查登录信息或重新登录。', 'Check your credentials or sign in again.'), 403: text('没有权限执行此操作。', 'You do not have permission to do that.'), 413: text('图片不能超过 1 MB。', 'Images must be 1 MB or smaller.') };
        const failure = new Error(hints[response.status] ?? error.detail ?? text('请求失败，请稍后重试。', 'The request failed. Please try again.'));
        failure.status = response.status;
        throw failure;
    }
    return response.headers.get('content-type')?.includes('application/json') ? response.json() : null;
}

function sendJson(path, method, data) {
    return request(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
}

const editorLoginDialog = byId('editor-login-dialog');
const editorLoginForm = byId('editor-login-form');
let adminEdit;

function beginAdminEdit(modal, showError) {
    if (!orderManagement) return;
    const { id, username } = session.user;
    adminEdit = { modal, showError, id, username, lastPing: 0, needsLogin: false };
}

function editorSignIn(edit) {
    edit.needsLogin = true;
    edit.showError(text('登录已过期。请重新登录后再次保存。', 'Your session expired. Sign in and save again.'));
    if (editorLoginDialog.open) return;
    editorLoginForm.elements.username.value = edit.username;
    setFormError('editor-login-error');
    editorLoginDialog.showModal();
}

async function handleEditError(edit, error, showError) {
    if (edit && adminEdit === edit && edit.modal.open && [401, 403].includes(error.status)) {
        try {
            const current = await request('/api/session');
            if (adminEdit !== edit || !edit.modal.open) return;
            if (current.user?.id !== edit.id) {
                editorSignIn(edit);
                return;
            }
            session = current;
            if (current.user.role === 'ADMIN') {
                showError(text('登录信息已刷新，请再次保存。', 'Sign-in details refreshed. Save again.'));
                return;
            }
        } catch (sessionError) {
            error = sessionError;
        }
    }
    showError(edit && error instanceof TypeError
        ? text('无法连接服务器。表单内容已保留，请恢复网络后重试。', 'Could not reach the server. Your edits are still here.')
        : error.message);
}

function canSubmitEdit(edit) {
    if (!edit?.needsLogin) return true;
    editorSignIn(edit);
    return false;
}

function endAdminEdit(modal) {
    if (adminEdit?.modal !== modal || modal.open) return;
    adminEdit = undefined;
    if (editorLoginDialog.open) editorLoginDialog.close();
}

function keepEditingSession(event) {
    const edit = adminEdit;
    if (!event.isTrusted || !edit || edit.modal !== event.currentTarget || !edit.modal.open ||
            !isAdmin() || edit.needsLogin || edit.checking || document.visibilityState !== 'visible' ||
            !document.hasFocus() || Date.now() - edit.lastPing < 30000) return;
    edit.lastPing = Date.now();
    edit.checking = true;
    request('/api/admin/edit-session', { cache: 'no-store' }).then(account => {
        if (adminEdit === edit && edit.modal.open && account.id !== edit.id) edit.needsLogin = true;
    }).catch(error => {
        if (adminEdit === edit && edit.modal.open && error.status === 401) edit.needsLogin = true;
    }).finally(() => { edit.checking = false; });
}

byId('cancel-editor-login').addEventListener('click', () => editorLoginDialog.close());
editorLoginDialog.addEventListener('close', () => editorLoginForm.reset());
editorLoginForm.addEventListener('submit', async event => {
    event.preventDefault();
    const edit = adminEdit;
    const submit = byId('editor-login-submit');
    if (!edit || submit.disabled) return;
    submit.disabled = true;
    setFormError('editor-login-error');
    try {
        session = await request('/api/session');
        await authenticate(edit.username, editorLoginForm.elements.password.value);
        await loadSession();
        if (adminEdit !== edit || !edit.modal.open) return;
        if (session.user?.id !== edit.id || !isAdmin()) {
            throw new Error(text('请使用原店长账号继续编辑。', 'Use the original manager account to continue.'));
        }
        edit.needsLogin = false;
        edit.lastPing = Date.now();
        editorLoginDialog.close();
        edit.showError();
        showToast(text('已重新登录，请再次点击保存。', 'Signed in again. Select Save to submit.'));
    } catch (error) {
        setFormError('editor-login-error', error instanceof TypeError
            ? text('无法连接服务器。请恢复网络后重试，表单内容仍会保留。', 'Reconnect and try again. Your edits are still here.')
            : error.message);
    } finally {
        editorLoginForm.elements.password.value = '';
        submit.disabled = false;
    }
});

function showNotice(message = '', error = false) {
    if (error) hideToast();
    const notice = byId('notice');
    notice.textContent = message;
    notice.classList.toggle('error', error);
    notice.hidden = !message;
}

function setFormError(id, message = '') {
    const alert = byId(id);
    alert.textContent = message;
    alert.hidden = !message;
}

function hideToast() {
    clearTimeout(toastTimer);
    byId('toast').hidden = true;
}

function showToast(message) {
    showNotice();
    hideToast();
    const toast = byId('toast');
    toast.hidden = false;
    toast.textContent = message;
    toastTimer = setTimeout(hideToast, 2500);
}

function quantityControls(dish, quantity) {
    const add = button(quantity ? 'counter-btn' : 'add-btn', '+', event => updateCart(dish, 1, event));
    add.setAttribute('aria-label', text(`增加一份${dish.name}`, `Add one ${dish.name}`));
    add.disabled = quantity >= maxPerDish || submitting || !dish.available;
    if (!quantity) return add;

    const subtract = button('counter-btn', '−', event => updateCart(dish, -1, event));
    subtract.setAttribute('aria-label', text(`减少一份${dish.name}`, `Remove one ${dish.name}`));
    subtract.disabled = submitting;

    const group = element('div', 'counter-group');
    group.append(subtract, element('span', 'counter-num', quantity), add);
    return group;
}

function updateCart(dish, delta, event) {
    const quantity = (cart.get(dish.id) ?? 0) + delta;
    if (submitting || quantity < 0 || quantity > maxPerDish) return;

    const container = event.currentTarget.closest('.dish-card, .cart-row').parentElement;
    const label = event.currentTarget.getAttribute('aria-label');
    if (quantity) cart.set(dish.id, quantity);
    else cart.delete(dish.id);

    renderCategory();
    renderCart();
    const controls = [...container.querySelectorAll('button:not(:disabled)')];
    const focusTarget = controls.find(node => node.getAttribute('aria-label') === label)
        ?? controls.find(node => node.getAttribute('aria-label') === text(`增加一份${dish.name}`, `Add one ${dish.name}`))
        ?? controls.find(node => node.getAttribute('aria-label') === text(`减少一份${dish.name}`, `Remove one ${dish.name}`))
        ?? controls[0]
        ?? (container.id === 'cart-items-container' ? byId('back-to-menu') : [...tabs].find(tab => tab.classList.contains('active') && tab.getClientRects().length));
    focusTarget.focus({ preventScroll: true });
}

function renderCategory() {
    const favorites = new Set(session?.user?.favorites);
    const visible = dishes.filter(dish => dish.category === currentCategory &&
        (!currentSubcategory || dish.subcategory === currentSubcategory));
    visible.sort((a, b) => Number(favorites.has(b.id)) - Number(favorites.has(a.id)));
    const list = byId('full-dish-list');
    const heading = byId('category-heading');
    heading.textContent = currentCategory;
    subcategoryFilters.hidden = !orderManagement || currentCategory !== 'Chinese';
    heading.classList.toggle('with-subcategories', !subcategoryFilters.hidden);
    const count = byId('menu-count');
    count.textContent = text(`${visible.length} 道菜品`, `${visible.length} ${visible.length === 1 ? 'dish' : 'dishes'}`);
    count.hidden = false;
    byId('add-dish').hidden = !isAdmin();
    list.replaceChildren();
    for (const dish of visible) {
        const card = element('article', 'dish-card');
        card.classList.toggle('dish-layout', orderManagement);
        const link = button('dish-link', undefined, () => openDishDetails(dish));
        link.setAttribute('aria-label', text(`查看${dish.name}菜谱`, `View recipe for ${dish.name}`));
        link.dataset.dishId = dish.id;
        const photo = element('img', 'dish-img');
        photo.src = dishPhotoPath(dish) ?? '/images/kitchen-avatar.jpg';
        photo.alt = '';
        const thumbnail = element('span', 'dish-thumbnail');
        thumbnail.append(photo);
        const descriptions = [`dish-price-${dish.id}`];
        if (favorites.has(dish.id)) {
            const heart = element('span', 'dish-favorite', '♥');
            heart.setAttribute('aria-hidden', 'true');
            const label = element('span', 'sr-only', text('已收藏', 'Favorited'));
            label.id = `dish-favorite-${dish.id}`;
            descriptions.push(label.id);
            thumbnail.append(heart, label);
        }
        const details = element('div', 'dish-meta');
        const price = element('span', 'dish-price', money.format(dish.price));
        price.id = `dish-price-${dish.id}`;
        const info = element('span', 'dish-info');
        const name = element('span', 'dish-name', dish.name);
        if (orderManagement) {
            const title = element('span', 'dish-title-line');
            title.append(name, price);
            info.append(title);
        } else {
            info.append(name);
            details.append(price);
        }
        if (dish.description) info.append(element('span', 'dish-description', dish.description));
        if (dish.available) {
            details.append(quantityControls(dish, cart.get(dish.id) ?? 0));
        } else {
            const availability = element('span', 'sold-out', text('已售罄', 'Sold out'));
            availability.id = `dish-availability-${dish.id}`;
            details.append(availability);
            descriptions.push(availability.id);
        }

        link.setAttribute('aria-describedby', descriptions.join(' '));
        link.append(thumbnail, info);
        card.append(link, details);
        list.append(card);
    }
    if (!visible.length) list.append(element('p', 'empty', text('这个分类暂时没有菜品。', 'No dishes in this category yet.')));
}

function updateRecipeScrollTarget() {
    byId('recipe-view').tabIndex = recipeSplit.matches ? -1 : 0;
    byId('recipe-content').tabIndex = recipeSplit.matches ? 0 : -1;
}

function openDishDetails(dish) {
    recipeDish = dish;
    setFormError('recipe-edit-error');
    recipeMenuPosition = byId('view-menu').hidden ? undefined : {
        category: currentCategory,
        scrollTop: document.querySelector('.menu-scroll').scrollTop
    };
    dialog.classList.add('recipe-mode');
    byId('dish-editor').hidden = true;
    byId('recipe-view').hidden = false;
    dialog.setAttribute('aria-labelledby', 'modal-title');
    renderRecipeActions();
    const photo = byId('modal-img');
    photo.src = dishPhotoPath(dish) ?? '/images/kitchen-avatar.jpg';
    photo.alt = dish.imagePath ? dish.name : '';
    const title = byId('modal-title');
    title.textContent = dish.name;
    byId('modal-price').textContent = money.format(dish.price);
    byId('modal-description').textContent = dish.description;

    const recipe = dish.recipe;
    const ingredients = recipe.ingredients.map(ingredient => {
        const row = element('div', 'read-i-row');
        row.append(element('dt', '', ingredient.name), element('dd', 'q-tag', ingredient.amount));
        return row;
    });
    byId('modal-ingredients').replaceChildren(...ingredients);
    byId('modal-steps').replaceChildren(...recipe.steps.map(step => element('li', 'read-s-row', step)));
    byId('modal-tips').textContent = recipe.tips ?? '';
    byId('modal-tips-area').hidden = !recipe.tips;
    if (!dialog.open) dialog.showModal();
    updateRecipeScrollTarget();
    byId('recipe-view').scrollTop = 0;
    byId('recipe-content').scrollTop = 0;
    title.focus({ preventScroll: true });
}

function renderCart() {
    const list = byId('cart-items-container');
    list.replaceChildren();
    let cents = 0;
    let count = 0;
    for (const dish of dishes) {
        const quantity = cart.get(dish.id);
        if (!quantity) continue;
        const row = element('article', 'cart-row');
        const info = element('div', '');
        info.append(element('h3', 'dish-name', dish.name), element('p', 'dish-price', money.format(dish.price)));
        row.append(info, quantityControls(dish, quantity));
        list.append(row);
        cents += Math.round(dish.price * 100) * quantity;
        count += quantity;
    }
    if (!count) list.append(element('p', 'empty', text('购物车空空如也。', 'Your cart is empty.')));
    byId('cart-badge').textContent = count;
    cartButton.setAttribute('aria-label', text(`打开购物车（${count} 份）`, `Open cart (${count} ${count === 1 ? 'item' : 'items'})`));
    byId('cart-total').textContent = money.format(cents / 100);
    byId('place-order').disabled = !count || submitting;
}

async function loadDishesFromServer() {
    dishes = await request('/api/dishes');
    for (const id of cart.keys()) {
        if (!dishes.some(dish => dish.id === id && dish.available)) cart.delete(id);
    }
    renderCategory();
    renderCart();
    renderProfile();
}

async function placeOrder() {
    if (submitting || !cart.size) return;
    if (!session?.user) {
        returnToCart = true;
        switchTab('view-profile');
        showNotice(text('请先登录，购物车会保留。', 'Sign in to place your order. Your cart will be saved.'));
        return;
    }
    submitting = true;
    renderCategory();
    renderCart();
    showNotice();

    try {
        const items = Array.from(cart, ([dishId, quantity]) => ({ dishId, quantity }));
        const order = await request('/api/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items })
        });
        cart.clear();
        const label = orderLabel(order);
        showToast(text(`${label} 已下单 · ${money.format(order.total)}`, `${label} placed · ${money.format(order.total)}`));
    } catch (error) {
        showNotice(error.message, true);
        await loadDishesFromServer().catch(() => {});
    } finally {
        submitting = false;
        renderCategory();
        renderCart();
    }
}

function orderLabel(order) {
    const number = order.displayNumber ?? order.id;
    return text(`订单 #${number}`, `Order #${number}`);
}

function orderCard(order) {
    const card = element('article', 'history-card');
    const heading = element('div', 'receipt-heading');
    const time = element('time', 'receipt-time', orderTime.format(new Date(order.createdAt)));
    time.dateTime = order.createdAt;
    const title = element('h3', 'receipt-number', orderLabel(order));
    const total = element('strong', 'receipt-total', text(`合计 ${money.format(order.total)}`, `Total ${money.format(order.total)}`));
    if (orderManagement) {
        card.classList.add('editable-order');
        const details = element('div', 'receipt-details');
        details.append(time);
        if (isAdmin()) details.append(element('p', 'receipt-orderer', text(`下单人：${order.orderer}`, `Ordered by: ${order.orderer}`)));
        heading.append(title, details, total);
    } else {
        heading.append(title, time, element('span', `status ${order.status.toLowerCase()}`, statusLabels[order.status]), total);
    }
    const list = element('ul', 'receipt-items');
    for (const item of order.items) {
        const line = element('li', 'receipt-line');
        const itemName = text(item.name, legacyDemoNames.get(item.name) ?? item.name);
        line.append(element('span', '', `${item.quantity} × ${itemName}`),
            element('span', '', text(`${money.format(item.unitPrice)} / 份`, `${money.format(item.unitPrice)} each`)));
        list.append(line);
    }
    const target = nextStatus[order.status];
    if (!orderManagement && target && isAdmin()) {
        const change = button('primary-btn order-action', target === 'PREPARING' ? text('开始制作', 'Start preparing') : text('标记完成', 'Mark completed'),
            async () => {
                change.disabled = true;
                showNotice();
                try {
                    const updated = await request(`/api/orders/${order.id}/status`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: target })
                    });
                    showToast(`${orderLabel(updated)} · ${statusLabels[updated.status]}`);
                    await renderOrders();
                } catch (error) {
                    showNotice(error.message, true);
                    change.disabled = false;
                }
            });
        heading.append(change);
    }

    card.append(heading, list);
    if (orderManagement && isAdmin()) {
        const actions = element('div', 'order-management-actions');
        actions.append(
            button('secondary-btn', text('编辑订单', 'Edit order'), () => openOrderEditor(order)),
            button('secondary-btn danger', text('删除订单', 'Delete order'), event => deleteOrder(order, event.currentTarget))
        );
        card.append(actions);
    }
    return card;
}

const orderDialog = byId('order-editor-dialog');
let editingOrder;

async function openOrderEditor(order) {
    if (orderDialog.open) return;
    try {
        const menu = await request('/api/dishes');
        if (orderDialog.open || !isAdmin() || byId('view-order').hidden) return;
        const snapshots = new Map(order.items.map(item => [item.dishId, item]));
        const choices = new Map(menu.filter(dish => dish.available)
            .map(dish => [dish.id, { dishId: dish.id, name: dish.name, unitPrice: dish.price }]));
        for (const [id, item] of snapshots) choices.set(id, item);
        editingOrder = { id: order.id, items: new Map(order.items.map(item => [item.dishId, { ...item }])), choices };
        byId('order-editor-title').textContent = text(`编辑${orderLabel(order)}`, `Edit ${orderLabel(order).toLowerCase()}`);
        setFormError('order-editor-error');
        renderOrderEditor();
        orderDialog.showModal();
        beginAdminEdit(orderDialog, message => setFormError('order-editor-error', message));
    } catch (error) {
        showNotice(error.message, true);
    }
}

function renderOrderEditor() {
    const { items, choices } = editingOrder;
    const list = byId('order-editor-lines');
    list.replaceChildren();
    for (const item of items.values()) {
        const line = element('li', 'order-editor-line');
        const label = element('span', '', item.name);
        label.append(element('small', '', money.format(item.unitPrice)));
        const count = element('input', '');
        count.type = 'number';
        count.min = 1;
        count.max = maxPerDish;
        count.required = true;
        count.value = item.quantity;
        count.setAttribute('aria-label', text(`${item.name}的数量`, `Quantity for ${item.name}`));
        count.addEventListener('input', () => { item.quantity = count.value; });
        line.append(label, count, button('secondary-btn', text('移除', 'Remove'), () => {
            items.delete(item.dishId);
            renderOrderEditor();
        }));
        list.append(line);
    }
    const picker = byId('order-dish-picker');
    picker.replaceChildren();
    for (const dish of choices.values()) {
        if (items.has(dish.dishId)) continue;
        const option = element('option', '', `${dish.name} · ${money.format(dish.unitPrice)}`);
        option.value = dish.dishId;
        picker.append(option);
    }
    picker.disabled = !picker.options.length;
    byId('add-order-dish').disabled = picker.disabled || items.size >= 30;
}

byId('add-order-dish').addEventListener('click', () => {
    const dish = editingOrder.choices.get(Number(byId('order-dish-picker').value));
    if (!dish) return;
    editingOrder.items.set(dish.dishId, { ...dish, quantity: 1 });
    renderOrderEditor();
});
byId('close-order-editor').addEventListener('click', () => {
    if (!byId('save-order').disabled) orderDialog.close();
});
orderDialog.addEventListener('cancel', event => {
    if (byId('save-order').disabled) event.preventDefault();
});
orderDialog.addEventListener('close', () => endAdminEdit(orderDialog));
byId('order-editor').addEventListener('submit', async event => {
    event.preventDefault();
    const { id, items } = editingOrder;
    const save = byId('save-order');
    const edit = adminEdit;
    if (save.disabled || !canSubmitEdit(edit)) return;
    setFormError('order-editor-error');
    if (!items.size) {
        setFormError('order-editor-error', text('订单至少需要一道菜。', 'Add at least one dish to the order.'));
        return;
    }
    save.disabled = true;
    try {
        await sendJson(`/api/admin/orders/${id}`, 'PUT', {
            items: [...items.values()].map(item => ({ dishId: item.dishId, quantity: Number(item.quantity) }))
        });
        orderDialog.close();
        showToast(text('订单已保存。', 'Order saved.'));
        await renderOrders();
    } catch (error) {
        if (orderDialog.open) await handleEditError(edit, error, message => setFormError('order-editor-error', message));
        else showNotice(error.message, true);
    } finally {
        save.disabled = false;
    }
});

async function deleteOrder(order, control) {
    const label = orderLabel(order);
    if (!window.confirm(text(`确定删除${label} 吗？`, `Delete ${label.toLowerCase()}?`))) return;
    control.disabled = true;
    try {
        await request(`/api/admin/orders/${order.id}`, { method: 'DELETE' });
        showToast(text('订单已删除。', 'Order deleted.'));
        await renderOrders();
    } catch (error) {
        showNotice(error.message, true);
        control.disabled = false;
    }
}

async function renderOrders() {
    const list = byId('order-history-list');
    const viewer = session?.user?.username;
    const orders = await request('/api/orders');
    if (viewer !== session?.user?.username) return;
    list.replaceChildren(...orders.map(orderCard));
    if (!orders.length) list.append(element('p', 'empty', text('暂无订单。', 'No orders yet.')));
}

function refreshOrders() {
    const list = byId('order-history-list');
    list.replaceChildren();
    byId('refresh-orders').hidden = !session?.user;
    byId('view-order').classList.toggle('manager-orders', isAdmin());
    byId('order-title').textContent = isAdmin() ? text('厨房订单', 'Kitchen orders') : text('我的订单', 'My orders');
    if (!session?.user) {
        const prompt = element('div', 'order-login-card');
        prompt.append(
            element('p', '', text('登录后可查看自己的订单。', 'Sign in to view your orders.')),
            button('secondary-btn', text('去登录', 'Sign in'), () => switchTab('view-profile'))
        );
        list.append(prompt);
        return;
    }
    renderOrders().catch(error => showNotice(error.message, true));
}

function readNavigation() {
    try {
        return JSON.parse(sessionStorage.getItem('kitchen-navigation')) ?? {};
    } catch {
        return {};
    }
}

function saveNavigation() {
    try {
        sessionStorage.setItem('kitchen-navigation', JSON.stringify({
            view: app.dataset.activeView,
            category: currentCategory
        }));
    } catch {
        // Navigation still works when browser storage is unavailable.
    }
}

function switchTab(activeView) {
    if (!views.some(view => view.id === activeView)) activeView = defaultView;
    if (privateMode && !session?.user) activeView = 'view-profile';
    app.dataset.activeView = activeView;
    if (activeView === 'view-cart') cartButton.setAttribute('aria-current', 'page');
    else cartButton.removeAttribute('aria-current');
    for (const view of views) view.hidden = view.id !== activeView;
    for (const tab of tabs) {
        const active = tab.dataset.view === activeView;
        tab.classList.toggle('active', active);
        if (active) tab.setAttribute('aria-current', 'page');
        else tab.removeAttribute('aria-current');
    }
    if (activeView === 'view-cart') renderCart();
    if (activeView === 'view-order') refreshOrders();
    if (activeView === 'view-profile') renderProfile();
    saveNavigation();
}

for (const [category, control] of categories) {
    control.addEventListener('click', () => activateCategory(category));
}
for (const tab of tabs) tab.addEventListener('click', () => switchTab(tab.dataset.view));

cartButton.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    suppressCartClick = false;
    if (!mobileLayout.matches || app.dataset.activeView !== 'view-menu') return;
    const bounds = cartButton.getBoundingClientRect();
    cartDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: bounds.left, top: bounds.top };
    cartButton.setPointerCapture(event.pointerId);
});
cartButton.addEventListener('pointermove', event => {
    if (event.pointerId !== cartDrag?.id) return;
    const dx = event.clientX - cartDrag.x;
    const dy = event.clientY - cartDrag.y;
    if (!suppressCartClick && Math.hypot(dx, dy) < 7) return;
    suppressCartClick = true;
    cartButton.style.setProperty('--cart-x', `${cartDrag.left + dx}px`);
    cartButton.style.setProperty('--cart-y', `${cartDrag.top + dy}px`);
    cartButton.classList.add('is-positioned');
});
cartButton.addEventListener('lostpointercapture', event => {
    if (event.pointerId === cartDrag?.id) cartDrag = undefined;
});
cartButton.addEventListener('click', event => {
    if (event.detail !== 0 && suppressCartClick) {
        suppressCartClick = false;
        return;
    }
    switchTab('view-cart');
    byId('back-to-menu').focus();
});
byId('back-to-menu').addEventListener('click', () => {
    switchTab('view-menu');
    cartButton.focus();
});

function closeDishDialog() {
    if (!savingDish) dialog.close();
}

dialog.querySelector('.close-icon').addEventListener('click', closeDishDialog);
dialog.addEventListener('cancel', event => {
    if (savingDish) event.preventDefault();
});
function outside(element, event) {
    const bounds = element.getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX >= bounds.right ||
        event.clientY < bounds.top || event.clientY >= bounds.bottom;
}

function isNativeBackdrop(event) {
    return event.target === dialog && outside(dialog, event);
}

dialog.addEventListener('pointerdown', event => {
    if (event.isPrimary) desktopBackdropStart = event.button === 0 && isNativeBackdrop(event);
});
dialog.addEventListener('pointercancel', () => { desktopBackdropStart = false; });
dialog.addEventListener('click', event => {
    if (desktopBackdropStart && isNativeBackdrop(event)) closeDishDialog();
    desktopBackdropStart = false;
});

recipeBackdrop.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    touchBackdropStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
    backdropTap = false;
});
recipeBackdrop.addEventListener('pointercancel', () => {
    touchBackdropStart = undefined;
    backdropTap = false;
});
recipeBackdrop.addEventListener('pointerup', event => {
    const start = touchBackdropStart;
    if (event.pointerId !== start?.id) return;
    touchBackdropStart = undefined;
    backdropTap = outside(dialog.querySelector('.dialog-surface'), event) &&
        Math.hypot(event.clientX - start.x, event.clientY - start.y) < 10;
});
recipeBackdrop.addEventListener('click', () => {
    if (backdropTap) closeDishDialog();
    backdropTap = false;
});
byId('place-order').addEventListener('click', placeOrder);

function setRegistrationMode(enabled) {
    registering = enabled;
    setFormError('auth-error');
    byId('register-nickname').hidden = !enabled;
    byId('toggle-register').textContent = enabled ? text('返回登录', 'Back to sign in') : text('新食客注册', 'Create an account');
    byId('auth-submit').textContent = enabled ? text('注册并登录', 'Register and sign in') : text('登录', 'Sign in');
    const password = byId('auth-form').elements.password;
    password.value = '';
    password.autocomplete = enabled ? 'new-password' : 'current-password';
}

async function loadSession() {
    session = await request('/api/session');
    const canBrowse = !privateMode || Boolean(session.user);
    document.documentElement.dataset.canBrowse = String(canBrowse);
    if (canBrowse) {
        if (!publicAvatar && !session.user) {
            kitchenAvatar.src = defaultKitchenAvatar;
        } else if (!kitchenAvatar.getAttribute('src')?.startsWith('/api/kitchen/avatar')) {
            refreshAvatar();
        }
    } else {
        kitchenAvatar.removeAttribute('src');
        dishes = [];
        switchTab('view-profile');
    }
    kitchenAvatar.hidden = !canBrowse;
    renderCategory();
    renderProfile();
}

function renderProfile() {
    const account = session?.user;
    byId('unlogged-box').hidden = Boolean(account);
    byId('logged-box').hidden = !account;
    renderAvatarControls();
    if (!account) {
        byId('favorites-list').replaceChildren();
        return;
    }

    byId('profile-nickname').textContent = account.nickname;
    byId('profile-username').textContent = account.username;
    byId('profile-role').textContent = isAdmin() ? text('店长', 'Manager') : text('尊贵食客', 'Guest');
    const favorites = dishes.filter(dish => account.favorites.includes(dish.id));
    byId('favorites-list').replaceChildren(...favorites.map(dish => {
        const item = element('li', '');
        item.append(button('secondary-btn', dish.name, () => openDishDetails(dish)));
        return item;
    }));
    if (!favorites.length) byId('favorites-list').append(element('li', 'empty', text('暂无收藏菜品。', 'No favorite dishes yet.')));
}

async function authenticate(username, password) {
    try {
        await request('/api/login', { method: 'POST', body: new URLSearchParams({ username, password }) });
    } catch (error) {
        if (error.status === 401) throw new Error(text('用户名或密码不正确。', 'Incorrect username or password.'));
        if (error.status === 403) throw new Error(text('登录表单已过期，请重新尝试登录。', 'The sign-in form expired. Try signing in again.'));
        throw error;
    }
}

async function submitAuth(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const username = String(fields.get('username')).trim();
    const password = String(fields.get('password'));
    const submit = byId('auth-submit');
    const registration = byId('toggle-register');
    submit.disabled = true;
    registration.disabled = true;
    showNotice();
    setFormError('auth-error');
    try {
        await loadSession();
        if (registering) {
            await sendJson('/api/register', 'POST', { username, password, nickname: fields.get('nickname') });
        }
        await authenticate(username, password);
        try {
            await loadSession();
            if (!session.user) throw new Error();
        } catch {
            throw new Error(text('账号验证成功，但未能建立登录会话。请刷新当前页面后重试。', 'Your credentials were verified, but we could not start a session. Refresh and try again.'));
        }
        form.reset();
        if (privateMode) {
            await loadDishesFromServer();
            switchTab('view-menu');
        }
        if (!isAdmin()) showToast(text(`欢迎，${session.user.nickname}。`, `Welcome, ${session.user.nickname}.`));
        if (returnToCart) {
            returnToCart = false;
            switchTab('view-cart');
            byId('place-order').focus();
        }
    } catch (error) {
        setFormError('auth-error', error.message);
    } finally {
        form.elements.password.value = '';
        submit.disabled = false;
        registration.disabled = false;
    }
}

async function logout() {
    try {
        await request('/api/logout', { method: 'POST' });
        adminEdit = undefined;
        hideToast();
        session = null;
        byId('password-form').reset();
        byId('password-error').hidden = true;
        byId('password-settings').open = false;
        setFormError('nickname-error');
        setFormError('avatar-error');
        cart.clear();
        byId('order-history-list').replaceChildren();
        renderCategory();
        renderProfile();
        await loadSession();
        renderCart();
        setRegistrationMode(false);
        showToast(text('已退出登录。', 'Signed out.'));
    } catch (error) {
        showNotice(error.message, true);
    }
}

async function saveNickname(event) {
    event.preventDefault();
    setFormError('nickname-error');
    try {
        const form = event.currentTarget;
        session.user = await sendJson('/api/profile', 'PATCH', { nickname: form.elements.nickname.value });
        form.reset();
        form.closest('details').open = false;
        renderProfile();
        showToast(text('昵称已更新', 'Nickname updated'));
    } catch (error) {
        setFormError('nickname-error', error.message);
    }
}

async function changePassword(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('button');
    const alert = byId('password-error');
    alert.hidden = true;
    submit.disabled = true;
    try {
        await sendJson('/api/profile/password', 'PATCH', Object.fromEntries(new FormData(form)));
        form.reset();
        byId('password-settings').open = false;
        showToast(text('密码已更新', 'Password updated'));
    } catch (error) {
        alert.textContent = error.message;
        alert.hidden = false;
        form.elements.currentPassword.value = '';
    } finally {
        submit.disabled = false;
    }
}

function renderRecipeActions() {
    const favorite = byId('favorite-dish');
    const selected = session?.user?.favorites.includes(recipeDish.id);
    favorite.hidden = !session?.user;
    favorite.textContent = selected ? text('♥ 已收藏', '♥ Favorited') : text('♡ 收藏', '♡ Add to favorites');
    favorite.setAttribute('aria-pressed', String(Boolean(selected)));
    byId('edit-dish').hidden = !isAdmin();
}

async function toggleFavorite() {
    const account = session?.user;
    if (!account) return;
    const dishId = recipeDish.id;
    const control = byId('favorite-dish');
    const selected = account.favorites.includes(dishId);
    control.disabled = true;
    try {
        await request(`/api/favorites/${dishId}`, { method: selected ? 'DELETE' : 'PUT' });
        if (session?.user !== account) return;
        account.favorites = selected
            ? account.favorites.filter(id => id !== dishId)
            : [...account.favorites, dishId];
        renderCategory();
        renderProfile();
        if (dialog.open && recipeDish.id === dishId) renderRecipeActions();
    } catch (error) {
        showNotice(error.message, true);
    } finally {
        control.disabled = false;
    }
}

const avatarSettings = byId('avatar-settings');
const avatarDialog = byId('avatar-dialog');
const avatarTrigger = byId('manage-avatar');
const avatarClose = byId('close-avatar');
const avatarForm = byId('avatar-form');
const avatarSave = byId('save-avatar');
const avatarReset = byId('reset-avatar');
const headerAvatarEditing = orderManagement && language === 'zh-CN';

if (headerAvatarEditing) {
    avatarDialog.querySelector('.modal-scroll').append(avatarSettings);
    const label = byId('avatar-file-label');
    label.textContent = label.dataset.dialogLabel;
    avatarSave.textContent = avatarSave.dataset.dialogLabel;
    avatarTrigger.addEventListener('click', () => {
        if (!isAdmin() || avatarDialog.open) return;
        avatarForm.reset();
        setFormError('avatar-error');
        avatarDialog.showModal();
    });
    avatarClose.addEventListener('click', () => avatarDialog.close());
    avatarDialog.addEventListener('cancel', event => {
        if (avatarSave.disabled) event.preventDefault();
    });
}

function renderAvatarControls() {
    const canEdit = isAdmin();
    avatarSettings.hidden = !canEdit;
    if (!headerAvatarEditing || avatarTrigger.hidden === !canEdit) return;
    if (canEdit) {
        avatarTrigger.append(kitchenAvatar);
    } else {
        if (avatarDialog.open) avatarDialog.close();
        avatarTrigger.before(kitchenAvatar);
    }
    avatarTrigger.hidden = !canEdit;
}

function refreshAvatar() {
    kitchenAvatar.src = `/api/kitchen/avatar?v=${Date.now()}`;
}

kitchenAvatar.addEventListener('error', () => {
    const source = kitchenAvatar.getAttribute('src');
    if (source && source !== defaultKitchenAvatar) kitchenAvatar.src = defaultKitchenAvatar;
});

function setAvatarBusy(busy) {
    avatarSave.disabled = avatarReset.disabled = avatarForm.elements.image.disabled = avatarClose.disabled = busy;
}

async function saveAvatar(event) {
    event.preventDefault();
    const image = avatarForm.elements.image.files[0];
    if (!image || avatarSave.disabled) return;
    setFormError('avatar-error');
    const progress = byId('avatar-progress');
    setAvatarBusy(true);
    progress.hidden = image.size <= maxImageBytes;
    try {
        const file = await prepareImage(image);
        progress.hidden = true;
        const payload = new FormData();
        payload.append('image', file);
        await request('/api/admin/avatar', { method: 'PUT', body: payload });
        avatarForm.reset();
        refreshAvatar();
        if (avatarDialog.open) avatarDialog.close();
        showToast(text('厨房头像已更新。', 'Kitchen avatar updated.'));
    } catch (error) {
        setFormError('avatar-error', error.message);
    } finally {
        progress.hidden = true;
        setAvatarBusy(false);
    }
}

async function resetAvatar() {
    if (avatarReset.disabled) return;
    setFormError('avatar-error');
    setAvatarBusy(true);
    try {
        await request('/api/admin/avatar', { method: 'DELETE' });
        refreshAvatar();
        if (avatarDialog.open) avatarDialog.close();
        showToast(text('已恢复默认头像。', 'Default avatar restored.'));
    } catch (error) {
        setFormError('avatar-error', error.message);
    } finally {
        setAvatarBusy(false);
    }
}

const editor = byId('dish-editor');
const dishSaveButton = byId('save-dish');
const maxImageBytes = 1024 * 1024;
const maxImageSide = 4096;
let editingId;
let removePhoto = false;
let previewUrl;
let selectedPhoto;
let photoSelection = 0;
let preparingPhoto = false;
let savingDish = false;

function setPreparingPhoto(preparing, compressing = false) {
    preparingPhoto = preparing;
    byId('photo-status').hidden = !compressing;
    dishSaveButton.disabled = preparingPhoto || savingDish;
}

function resetPhotoSelection() {
    photoSelection++;
    selectedPhoto = undefined;
    clearPreviewUrl();
    setPreparingPhoto(false);
}

function editorError(message = '') {
    const error = byId('editor-error');
    error.textContent = message;
    error.hidden = !message;
    if (message) editor.querySelector('.editor-scroll').scrollTop = 0;
}

function showPhotoPreview(url) {
    const photo = byId('editor-photo');
    if (url) photo.src = url;
    else photo.removeAttribute('src');
    photo.hidden = !url;
    byId('remove-photo').hidden = !url;
}

function clearPreviewUrl() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
}

const draftChoice = byId('dish-draft-dialog');
let draftDatabase;
let dishDraft;
let pendingDraftPhoto;
let openingDishEditor = false;

function draftTransaction(accountId, update) {
    draftDatabase ??= new Promise((resolve, reject) => {
        const opening = indexedDB.open('home-kitchen-drafts', 1);
        opening.onupgradeneeded = () => opening.result.createObjectStore('dishes');
        opening.onsuccess = () => resolve(opening.result);
        opening.onerror = () => reject(opening.error);
    }).catch(error => {
        draftDatabase = undefined;
        throw error;
    });
    return draftDatabase.then(database => new Promise((resolve, reject) => {
        const transaction = database.transaction('dishes', update ? 'readwrite' : 'readonly');
        const store = transaction.objectStore('dishes');
        const read = store.get(accountId);
        let result;
        read.onsuccess = () => { result = update ? update(store, read.result) : read.result; };
        transaction.oncomplete = () => resolve(result);
        transaction.onabort = () => reject(transaction.error);
    }));
}

function snapshotDish() {
    const fields = editor.elements;
    return {
        name: fields.name.value, category: fields.category.value, price: fields.price.value,
        subcategory: fields.category.value === 'Chinese' ? fields.subcategory.value : '',
        description: fields.description.value, available: fields.available.checked, tips: fields.tips.value,
        ingredients: [...byId('editable-ingredients').children].map(row => {
            const [name, amount, cost] = row.querySelectorAll('input');
            return { name: name.value, amount: amount.value, cost: cost?.value ?? '' };
        }),
        steps: [...byId('editable-steps').querySelectorAll('textarea')].map(input => input.value)
    };
}

function saveDishDraft() {
    const draft = dishDraft;
    if (!draft || !dialog.open) return;
    const record = { revision: crypto.randomUUID(), fields: snapshotDish(), photo: selectedPhoto, pendingPhoto: pendingDraftPhoto };
    const write = draft.lastWrite ?? Promise.resolve();
    draft.lastWrite = write.then(() => draftTransaction(draft.owner, (store, current) => {
        if (current?.revision !== draft.revision) return false;
        store.put(record, draft.owner);
        return true;
    })).then(saved => {
        if (saved) draft.revision = record.revision;
        if (dishDraft === draft && dialog.open) {
            setFormError('draft-error', saved ? '' : text('这份草稿已在其他页面被清除或替换。此表单仍可继续编辑和发布。',
                'This draft was cleared or replaced in another tab. You can still edit and publish this form.'));
        }
    }).catch(() => {
        if (dishDraft === draft && dialog.open) setFormError('draft-error', draftStorageError);
    });
}

const draftStorageError = text('浏览器未能保存草稿。请保留此页面，直到可以发布。',
    'The browser could not save the draft. Keep this page open until you can publish.');

function chooseDishDraft() {
    return new Promise(resolve => {
        draftChoice.returnValue = '';
        draftChoice.addEventListener('close', () => resolve(draftChoice.returnValue), { once: true });
        draftChoice.showModal();
    });
}

byId('continue-draft').addEventListener('click', () => draftChoice.close('continue'));
byId('cancel-draft-choice').addEventListener('click', () => draftChoice.close());
byId('replace-draft').addEventListener('click', () => {
    if (window.confirm(text('确定丢弃上次草稿并新建菜品吗？', 'Discard the previous draft and start a new dish?'))) {
        draftChoice.close('replace');
    }
});

async function confirmDraftAccount(owner) {
    if (!navigator.onLine) return isAdmin() && session.user.id === owner;
    try {
        await loadSession();
        if (isAdmin() && session.user.id === owner) return true;
        if (isAdmin()) {
            showNotice(text('登录账号已变更，请重新打开添加新菜品。', 'The signed-in account changed. Open Add dish again.'), true);
        } else {
            switchTab('view-profile');
            showNotice(text('请先登录店长账号，再打开菜品草稿。', 'Sign in as a manager to open a dish draft.'), true);
        }
    } catch {
        showNotice(text('暂时无法确认登录状态，请恢复网络后重试。', 'Could not check the session. Reconnect and try again.'), true);
    }
    return false;
}

async function startNewDish() {
    if (!isAdmin() || openingDishEditor) return;
    if (!orderManagement) {
        openEditor();
        return;
    }
    openingDishEditor = true;
    const owner = session.user.id;
    try {
        if (!await confirmDraftAccount(owner)) return;
        let saved = await draftTransaction(owner);
        if (saved) {
            const choice = await chooseDishDraft();
            if (!choice || !await confirmDraftAccount(owner)) return;
            if (choice === 'replace') {
                const cleared = await draftTransaction(owner, (store, current) => {
                    if (current?.revision !== saved.revision) return false;
                    store.delete(owner);
                    return true;
                });
                if (!cleared) {
                    showNotice(text('草稿已在其他页面改变，请重新打开添加菜品。', 'The draft changed in another tab. Open Add dish again.'), true);
                    return;
                }
                saved = undefined;
            }
        }
        if (!isAdmin() || session.user.id !== owner) return;
        openEditor(undefined, saved);
        dishDraft = { owner, revision: saved?.revision };
        if (saved?.pendingPhoto) void selectDishPhoto(saved.pendingPhoto);
    } catch {
        if (isAdmin() && session.user.id === owner) {
            openEditor();
            setFormError('draft-error', draftStorageError);
        }
    } finally {
        openingDishEditor = false;
    }
}

async function clearPublishedDraft(draft) {
    if (!draft) return true;
    try {
        await draft.lastWrite;
        await draftTransaction(draft.owner, (store, current) => {
            if (current && current.revision === draft.revision) store.delete(draft.owner);
        });
        return true;
    } catch {
        return false;
    }
}

function openEditor(dish, draft) {
    editingId = dish?.id;
    dishDraft = undefined;
    pendingDraftPhoto = undefined;
    dialog.classList.remove('recipe-mode');
    removePhoto = false;
    resetPhotoSelection();
    editor.reset();
    editorError();
    setFormError('draft-error');
    const fields = draft?.fields ?? dish;
    editor.elements.name.value = fields?.name ?? '';
    editor.elements.category.value = fields?.category ?? currentCategory;
    editor.elements.subcategory.value = fields?.subcategory ?? '';
    showDishSubcategory();
    editor.elements.price.value = fields?.price ?? '';
    editor.elements.description.value = fields?.description ?? '';
    editor.elements.available.checked = fields?.available ?? true;
    editor.elements.tips.value = draft?.fields.tips ?? dish?.recipe.tips ?? '';
    if (draft?.photo) {
        selectedPhoto = draft.photo;
        previewUrl = URL.createObjectURL(selectedPhoto);
    }
    showPhotoPreview(previewUrl ?? dishPhotoPath(dish));

    byId('editable-ingredients').replaceChildren();
    byId('editable-steps').replaceChildren();
    for (const ingredient of draft?.fields.ingredients ?? dish?.recipe.ingredients ?? []) addIngredient(ingredient);
    for (const step of draft?.fields.steps ?? dish?.recipe.steps ?? []) addStep(step);
    showAutomaticPrice();
    byId('editor-title').textContent = dish ? text('编辑菜谱', 'Edit recipe') : text('添加新菜品', 'Add dish');
    byId('delete-dish').hidden = !dish;
    byId('recipe-view').hidden = true;
    editor.hidden = false;
    dialog.setAttribute('aria-labelledby', 'editor-title');
    if (!dialog.open) dialog.showModal();
    beginAdminEdit(dialog, editorError);
    editor.querySelector('.editor-scroll').scrollTop = 0;
    editor.elements.name.focus();
}

async function editRecipe() {
    const dish = recipeDish;
    if (!orderManagement) {
        openEditor(dish);
        return;
    }
    const control = byId('edit-dish');
    if (!isAdmin() || control.disabled) return;
    control.disabled = true;
    setFormError('recipe-edit-error');
    try {
        const editable = await request(`/api/admin/dishes/${dish.id}`, { cache: 'no-store' });
        if (dialog.open && recipeDish === dish && editor.hidden && isAdmin()) openEditor(editable);
    } catch (error) {
        if (dialog.open && recipeDish === dish && editor.hidden) setFormError('recipe-edit-error', error.message);
    } finally {
        control.disabled = false;
    }
}

function showDishSubcategory() {
    const visible = orderManagement && editor.elements.category.value === 'Chinese';
    byId('dish-subcategory').hidden = !visible;
    editor.elements.subcategory.disabled = !visible;
}

function showAutomaticPrice() {
    const hint = byId('auto-dish-price');
    const costs = [...editor.querySelectorAll('.ingredient-cost')].filter(cost => cost.value !== '');
    hint.hidden = !orderManagement || Boolean(editor.elements.price.value) || costs.length === 0 ||
        costs.some(cost => !cost.validity.valid);
    if (!hint.hidden) {
        const cents = costs.reduce((sum, cost) => sum + Math.round(Number(cost.value) * 100), 0);
        hint.textContent = text(`按原料成本计算的菜价：${money.format(cents / 100)}`,
            `Price calculated from ingredients: ${money.format(cents / 100)}`);
    }
}

function textField(label, value, maxLength) {
    const input = element('input', '');
    input.setAttribute('aria-label', label);
    input.placeholder = label;
    input.maxLength = maxLength;
    input.value = value;
    return input;
}

function addIngredient(ingredient = { name: '', amount: '' }) {
    const row = element('div', 'ingredient-edit');
    const name = textField(text('原料名称', 'Ingredient name'), ingredient.name, 120);
    const amount = textField(text('用量', 'Amount'), ingredient.amount, 80);
    row.append(name, amount);
    if (orderManagement) {
        const cost = element('input', 'ingredient-cost');
        cost.type = 'number';
        cost.min = '0';
        cost.max = editor.elements.price.max;
        cost.step = '0.01';
        cost.inputMode = 'decimal';
        cost.setAttribute('aria-label', text('原料成本', 'Ingredient cost'));
        cost.placeholder = text('原料成本', 'Ingredient cost');
        cost.value = ingredient.cost ?? '';
        row.classList.add('with-cost');
        row.append(cost);
    }
    row.append(button('secondary-btn row-remove', text('移除', 'Remove'), () => {
        row.remove();
        showAutomaticPrice();
        saveDishDraft();
    }));
    byId('editable-ingredients').append(row);
    return name;
}

function addStep(step = '') {
    const item = element('li', 'step-edit');
    const row = element('div', 'step-fields');
    const input = element('textarea', '');
    input.setAttribute('aria-label', text('步骤内容', 'Step instructions'));
    input.placeholder = text('步骤内容', 'Step instructions');
    input.maxLength = 2000;
    input.rows = 2;
    input.value = step;
    row.append(input, button('secondary-btn row-remove', text('移除', 'Remove'), () => { item.remove(); saveDishDraft(); }));
    item.append(row);
    byId('editable-steps').append(item);
    return input;
}

function validatePhotoType(photo) {
    if (!['image/jpeg', 'image/png'].includes(photo.type)) {
        throw new Error(text('请选择 JPEG 或 PNG 图片。', 'Choose a JPEG or PNG image.'));
    }
}

async function prepareImage(file) {
    validatePhotoType(file);
    let image;
    try {
        image = await createImageBitmap(file);
    } catch {
        throw new Error(text('无法读取这张图片，请选择可正常打开的 JPEG 或 PNG 图片。',
            'Could not read this image. Choose a JPEG or PNG that opens normally.'));
    }

    try {
        const longSide = Math.max(image.width, image.height);
        if (file.size <= maxImageBytes) {
            if (longSide > maxImageSide) {
                throw new Error(text('图片长宽不能超过 4096 像素。', 'Image dimensions must be at most 4096 pixels.'));
            }
            return file;
        }

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        const qualities = file.type === 'image/jpeg' ? [0.92, 0.82, 0.72] : [undefined];
        let targetSide = Math.min(longSide, maxImageSide);
        const minSide = Math.min(targetSide, 320);
        try {
            while (context) {
                const scale = targetSide / longSide;
                canvas.width = Math.max(1, Math.round(image.width * scale));
                canvas.height = Math.max(1, Math.round(image.height * scale));
                context.imageSmoothingQuality = 'high';
                context.drawImage(image, 0, 0, canvas.width, canvas.height);

                let lastSize = 0;
                for (const quality of qualities) {
                    const compressed = await new Promise(resolve => canvas.toBlob(resolve, file.type, quality));
                    if (!compressed || compressed.type !== file.type) break;
                    if (compressed.size <= maxImageBytes) {
                        return new File([compressed], file.name, { type: file.type });
                    }
                    lastSize = compressed.size;
                }
                if (!lastSize || targetSide === minSide) break;

                const shrink = Math.max(0.5, Math.min(0.88, 0.94 * Math.sqrt(maxImageBytes / lastSize)));
                targetSide = Math.max(minSide, Math.floor(targetSide * shrink));
            }
        } catch {
            // Canvas encoding can fail on devices with limited image memory.
        } finally {
            canvas.width = canvas.height = 0;
        }
        throw new Error(text('无法将这张图片压缩到 1 MB 以内，请选择较小的 JPEG 或 PNG 图片。',
            'Could not compress this image to 1 MB. Choose a smaller JPEG or PNG.'));
    } finally {
        image.close();
    }
}

async function selectDishPhoto(file) {
    if (!file) return;
    const selection = ++photoSelection;
    editorError();
    pendingDraftPhoto = file;
    saveDishDraft();
    setPreparingPhoto(true, file.size > maxImageBytes);
    try {
        const photo = await prepareImage(file);
        if (selection !== photoSelection || !dialog.open) return;
        const url = URL.createObjectURL(photo);
        clearPreviewUrl();
        previewUrl = url;
        selectedPhoto = photo;
        showPhotoPreview(previewUrl);
        removePhoto = false;
    } catch (error) {
        if (selection !== photoSelection || !dialog.open) return;
        editor.elements.photo.value = '';
        editorError(error.message);
    } finally {
        if (selection === photoSelection) {
            pendingDraftPhoto = undefined;
            setPreparingPhoto(false);
            saveDishDraft();
        }
    }
}

async function saveDish(event) {
    event.preventDefault();
    const edit = adminEdit;
    if (preparingPhoto || savingDish || !canSubmitEdit(edit)) return;
    editorError();
    const fields = snapshotDish();
    const ingredients = fields.ingredients.map(item => ({
        name: item.name.trim(), amount: item.amount.trim(), cost: item.cost === '' ? null : Number(item.cost)
    }));
    if (ingredients.some(item => (item.amount || item.cost !== null) && !item.name)) {
        editorError(text('请为填写了用量或成本的原料输入名称。', 'Enter a name for each ingredient with an amount or cost.'));
        return;
    }
    if (fields.price === '' && !ingredients.some(item => item.cost !== null)) {
        editorError(text('请填写菜价，或至少填写一项原料成本。', 'Enter a price or at least one ingredient cost.'));
        return;
    }
    const data = {
        ...fields,
        name: fields.name.trim(), price: fields.price === '' ? null : Number(fields.price),
        subcategory: fields.subcategory || null, description: fields.description.trim(),
        ingredients: ingredients.filter(item => item.name),
        steps: fields.steps.map(step => step.trim()).filter(Boolean), tips: fields.tips.trim(),
        removeImage: removePhoto
    };
    if (!data.name) {
        editorError(text('请输入菜名。', 'Enter a dish name.'));
        return;
    }
    const payload = new FormData();
    payload.append('dish', new Blob([JSON.stringify(data)], { type: 'application/json' }));
    const replacingPhoto = Boolean(selectedPhoto);
    if (replacingPhoto) payload.append('image', selectedPhoto);

    const draft = dishDraft;
    savingDish = true;
    editor.querySelector('.form-fields').inert = true;
    dialog.querySelector('.close-icon').disabled = true;
    byId('delete-dish').disabled = true;
    dishSaveButton.disabled = true;
    try {
        const saved = await request(editingId ? `/api/admin/dishes/${editingId}` : '/api/admin/dishes', {
            method: editingId ? 'PUT' : 'POST', body: payload
        });
        if (replacingPhoto) dishPhotoVersions.set(saved.id, Date.now());
        const draftCleared = await clearPublishedDraft(draft);
        dialog.close();
        activateCategory(data.category);
        if (draftCleared) showToast(text('菜品已保存。', 'Dish saved.'));
        else showNotice(text('菜品已发布，但浏览器未能清除草稿。', 'The dish was published, but the browser could not clear the draft.'), true);
        await loadDishesFromServer().catch(() => {
            if (draftCleared) showNotice(text('菜品已发布，菜单刷新失败。请刷新页面查看。', 'The dish was published, but the menu did not refresh. Reload to view it.'), true);
        });
    } catch (error) {
        if (dialog.open) await handleEditError(edit, error, editorError);
        else showNotice(error.message, true);
    } finally {
        savingDish = false;
        editor.querySelector('.form-fields').inert = false;
        dialog.querySelector('.close-icon').disabled = false;
        byId('delete-dish').disabled = false;
        dishSaveButton.disabled = preparingPhoto;
    }
}

async function deleteDish() {
    if (!window.confirm(text('删除这道菜？已下单的订单会保留原菜名与价格。', 'Delete this dish? Existing orders will keep its original name and price.'))) return;
    try {
        await request(`/api/admin/dishes/${editingId}`, { method: 'DELETE' });
        dishPhotoVersions.delete(editingId);
        dialog.close();
        await loadDishesFromServer();
        showToast(text('菜品已删除。', 'Dish deleted.'));
    } catch (error) {
        if (dialog.open) editorError(error.message);
        else showNotice(error.message, true);
    }
}

function activateCategory(category, subcategory = '') {
    currentCategory = categories.has(category) ? category : defaultCategory;
    currentSubcategory = currentCategory === 'Chinese' && subcategories.has(subcategory) ? subcategory : '';
    for (const [value, item] of categories) {
        const active = value === currentCategory;
        item.classList.toggle('active', active);
        item.setAttribute('aria-pressed', String(active));
    }
    for (const filter of subcategoryFilters.children) {
        const active = filter.dataset.subcategory === currentSubcategory;
        filter.classList.toggle('active', active);
        filter.setAttribute('aria-pressed', String(active));
    }
    renderCategory();
    document.querySelector('.menu-scroll').scrollTop = 0;
    saveNavigation();
}

byId('refresh-orders').addEventListener('click', refreshOrders);
byId('toggle-register').addEventListener('click', () => setRegistrationMode(registrationOpen && !registering));
byId('auth-form').addEventListener('submit', submitAuth);
byId('logout').addEventListener('click', logout);
byId('nickname-form').addEventListener('submit', saveNickname);
byId('password-settings').hidden = document.documentElement.dataset.passwordChanges !== 'true';
byId('password-form').addEventListener('submit', changePassword);
byId('favorite-dish').addEventListener('click', toggleFavorite);
avatarForm.addEventListener('submit', saveAvatar);
avatarReset.addEventListener('click', resetAvatar);
byId('add-dish').addEventListener('click', startNewDish);
recipeSplit.addEventListener('change', updateRecipeScrollTarget);
byId('edit-dish').addEventListener('click', editRecipe);
editor.elements.category.querySelector('option[value="Thai"]').hidden = !orderManagement;
editor.elements.price.required = !orderManagement;
for (const [value, label] of [['', text('全部中餐', 'All Chinese dishes')], ...subcategories]) {
    const control = button('cuisine-item', label, () => activateCategory('Chinese', value));
    control.dataset.subcategory = value;
    subcategoryFilters.append(control);
    const option = element('option', '', value ? label : text('不指定', 'Unspecified'));
    option.value = value;
    editor.elements.subcategory.append(option);
}
byId('add-ingredient').addEventListener('click', () => { addIngredient().focus(); saveDishDraft(); });
byId('add-step').addEventListener('click', () => { addStep().focus(); saveDishDraft(); });
editor.elements.photo.addEventListener('change', () => selectDishPhoto(editor.elements.photo.files[0]));
editor.addEventListener('input', () => {
    showDishSubcategory();
    showAutomaticPrice();
    saveDishDraft();
});
byId('remove-photo').addEventListener('click', () => {
    editor.elements.photo.value = '';
    resetPhotoSelection();
    removePhoto = true;
    pendingDraftPhoto = undefined;
    showPhotoPreview(null);
    saveDishDraft();
});
byId('delete-dish').addEventListener('click', deleteDish);
editor.addEventListener('submit', saveDish);
for (const modal of [dialog, orderDialog]) {
    for (const type of ['keydown', 'pointerdown', 'input']) modal.addEventListener(type, keepEditingSession);
}

dialog.addEventListener('close', () => {
    endAdminEdit(dialog);
    dishDraft = undefined;
    pendingDraftPhoto = undefined;
    resetPhotoSelection();
    desktopBackdropStart = false;
    touchBackdropStart = undefined;
    backdropTap = false;
    if (dialog.classList.contains('recipe-mode') && recipeMenuPosition?.category === currentCategory &&
            !byId('view-menu').hidden) {
        const scroller = document.querySelector('.menu-scroll');
        scroller.querySelector(`[data-dish-id="${recipeDish.id}"]`)?.focus({ preventScroll: true });
        scroller.scrollTop = recipeMenuPosition.scrollTop;
    }
    recipeMenuPosition = undefined;
});

byId('toggle-register').hidden = !registrationOpen;
const savedNavigation = readNavigation();
loadSession().catch(error => showNotice(error.message, true)).then(() => {
    activateCategory(savedNavigation.category);
    switchTab(savedNavigation.view);
    if (!privateMode || session?.user) return loadDishesFromServer();
}).catch(error => showNotice(error.message, true));
