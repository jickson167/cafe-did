function normalizeOrder(item) {
    if (typeof item === 'string') {
        return { number: item, menu: '' };
    }

    if (!item || typeof item !== 'object') {
        return { number: '', menu: '' };
    }

    return {
        number: String(item.n || item.number || '').trim(),
        menu: String(item.m || item.menu || '').trim()
    };
}

function normalizeOrders(items) {
    if (!Array.isArray(items)) {
        return [];
    }

    return items
        .map(normalizeOrder)
        .filter((order) => order.number.length > 0);
}

function trimOrders(items, maxCount) {
    const normalized = normalizeOrders(items);
    if (normalized.length <= maxCount) {
        return normalized;
    }

    return normalized.slice(-maxCount);
}

function ordersSnapshotKey(orders) {
    return orders
        .map((order) => `${order.number}|${order.menu}`)
        .join(';;');
}

function ordersEqual(a, b) {
    return ordersSnapshotKey(a) === ordersSnapshotKey(b);
}

function getOrderNumbers(orders) {
    return orders.map((order) => order.number);
}

window.DidOrderData = {
    normalizeOrder,
    normalizeOrders,
    trimOrders,
    ordersEqual,
    getOrderNumbers
};
