import React, { useEffect } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SearchPage from './SearchPage';
import DetailsPage from '../DetailsPage/DetailsPage';
import { AppProvider, useAppContext } from '../../context/AppContext';

const originalFetch = global.fetch;

afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
});

function AuthenticatedRoutes() {
    const { setIsLoggedIn } = useAppContext();
    useEffect(() => setIsLoggedIn(true), [setIsLoggedIn]);

    return (
        <Routes>
            <Route path="/app/search" element={<SearchPage />} />
            <Route path="/app/item/:itemId" element={<DetailsPage />} />
            <Route path="*" element={<p>Unknown route</p>} />
        </Routes>
    );
}

test('View More opens the selected search result on the existing item details route', async () => {
    const item = {
        id: '42', name: 'Vintage desk', category: 'Office', condition: 'Like New',
        description: 'A sturdy desk ready for its next home.', image: '/images/desk.jpeg',
        date_added: '2026-11-09', age_years: 2, comments: []
    };
    global.fetch = jest.fn(async (url) => {
        if (url.endsWith('/api/secondchance/items')) {
            return { ok: true, json: async () => [item] };
        }
        if (url.endsWith('/api/secondchance/items/42')) {
            return { ok: true, json: async () => item };
        }
        throw new Error(`Unexpected HTTP request: ${url}`);
    });
    jest.spyOn(window, 'scrollTo').mockImplementation(() => {});

    render(
        <MemoryRouter initialEntries={['/app/search']}>
            <AppProvider><AuthenticatedRoutes /></AppProvider>
        </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole('button', { name: 'View More' }));

    expect(await screen.findByRole('heading', { level: 2, name: 'Vintage desk' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
});
