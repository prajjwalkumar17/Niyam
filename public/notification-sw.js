self.addEventListener('notificationclick', event => {
    event.notification.close();

    const data = event.notification.data || {};
    const targetUrl = data.url || '/#pending';
    const absoluteTarget = new URL(targetUrl, self.location.origin).href;

    event.waitUntil((async () => {
        const windows = await clients.matchAll({
            type: 'window',
            includeUncontrolled: true
        });

        for (const client of windows) {
            if ('navigate' in client) {
                await client.navigate(absoluteTarget);
            }
            if ('focus' in client) {
                return client.focus();
            }
        }

        if (clients.openWindow) {
            return clients.openWindow(absoluteTarget);
        }

        return null;
    })());
});
