import { Dataset, createPlaywrightRouter } from 'crawlee';

export const router = createPlaywrightRouter();

router.addDefaultHandler(async ({ enqueueLinks, log }) => {
    log.info(`enqueueing new URLs`);
    await enqueueLinks({
        globs: [
            'https://www.lightnovelpub.com/novel/shadow-slave-1365/chapter-2274',
        ],
        label: 'detail',
    });
});

router.addHandler('detail', async ({ request, page, log }) => {
    const title = await page.content();
    log.info(`${title}`, { url: request.loadedUrl });

    await Dataset.pushData({
        url: request.loadedUrl,
        title,
    });
});
