import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Navbar from './Navbar';
import { AppProvider } from '../../context/AppContext';

test('SecondChance brand links to the app on the current frontend origin', () => {
    render(
        <MemoryRouter initialEntries={['/app/search']}>
            <AppProvider><Navbar /></AppProvider>
        </MemoryRouter>
    );

    const destination = new URL(screen.getByRole('link', { name: 'SecondChance' }).href);

    expect(destination.origin).toBe(window.location.origin);
    expect(destination.pathname).toBe('/app');
});
