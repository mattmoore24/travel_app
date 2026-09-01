import { fireEvent, render, screen } from '@testing-library/react-native';
import fs from 'node:fs';
import path from 'node:path';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { CityField } from '@/components/form/city-field';
import { HitTarget } from '@/constants/theme';
import type { CityRow } from '@/lib/database.types';

/**
 * One city field, mounted everywhere a city is asked for.
 *
 * The typeahead was built into signup alone, which is the one form nobody who
 * already has an account will ever see again - so the fix for "the two forms
 * must not drift" was itself the drift, and every existing account went on
 * splitting Munich and Munchen and Munique forever. These prove the shared
 * component behaves, and that the form which was left out now mounts it.
 */

const mockSearch = jest.fn();
jest.mock('@/features/trips/hooks', () => ({
  useCitySearch: (query: string) => mockSearch(query),
}));

const REPO = path.join(__dirname, '..', '..', '..', '..');
const src = (file: string): string => fs.readFileSync(path.join(REPO, file), 'utf8');

const city = (over: Partial<CityRow> = {}): CityRow => ({
  id: 1,
  name: 'Munich',
  country_code: 'DE',
  country_name: 'Germany',
  admin: 'Bavaria',
  lat: 48.14,
  lng: 11.58,
  population: 1_500_000,
  ...over,
});

/** The field is controlled, so the test holds the value the way a screen does. */
function Host({ initial = '', onPick }: { initial?: string; onPick?: (c: CityRow) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <CityField
      label="Home city"
      testID="home-city"
      value={value}
      onChangeText={setValue}
      onPick={(choice) => {
        setValue(choice.name);
        onPick?.(choice);
      }}
    />
  );
}

/**
 * The real hook is `enabled` only from two characters, so it answers with
 * undefined until then. The mock has to do the same or every assertion about
 * the typing gate passes for the wrong reason.
 */
function answer(rows: CityRow[]) {
  mockSearch.mockImplementation((query: string) => ({
    data: query.trim().length >= 2 ? rows : undefined,
  }));
}

describe('the city field', () => {
  beforeEach(() => {
    answer([city()]);
  });

  it('asks for nothing until somebody types', () => {
    // Both forms that mount this are prefilled. Without the typing gate,
    // opening Edit profile shows a list of cities under a value nobody
    // touched.
    render(<Host initial="Munich" />);
    expect(mockSearch).toHaveBeenLastCalledWith('');
    expect(screen.queryByLabelText('Munich, Germany')).toBeNull();
  });

  it('offers what the reference table has once they do', () => {
    render(<Host />);
    fireEvent.changeText(screen.getByTestId('home-city'), 'Muni');
    expect(mockSearch).toHaveBeenLastCalledWith('Muni');
    expect(screen.getByLabelText('Munich, Germany')).toBeTruthy();
  });

  it('hands the whole row back, because the country comes off it too', () => {
    // The half that makes 'Deutschland', 'Germany' and 'DE' one country.
    const onPick = jest.fn();
    render(<Host onPick={onPick} />);
    fireEvent.changeText(screen.getByTestId('home-city'), 'Muni');
    fireEvent.press(screen.getByLabelText('Munich, Germany'));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ country_name: 'Germany' }));
  });

  it('puts the list away once one is picked', () => {
    render(<Host />);
    fireEvent.changeText(screen.getByTestId('home-city'), 'Muni');
    fireEvent.press(screen.getByLabelText('Munich, Germany'));
    expect(mockSearch).toHaveBeenLastCalledWith('');
    expect(screen.queryByLabelText('Munich, Germany')).toBeNull();
  });

  it('puts it away on Return as well, for a city the table does not carry', () => {
    // A home city nobody has heard of still has to be expressible. The
    // columns behind this are text and nothing about a suggestion list makes
    // them not.
    render(<Host />);
    const field = screen.getByTestId('home-city');
    fireEvent.changeText(field, 'Alfama');
    fireEvent(field, 'submitEditing');
    expect(mockSearch).toHaveBeenLastCalledWith('');
  });

  it('gives every row the whole 44pt hit target, which is why it is shared', () => {
    // THE REGRESSION THIS COMPONENT WAS EXTRACTED TO PREVENT, and nothing
    // asserted it. The hand-rolled copy carried no minHeight at all, which put
    // its rows near 39pt: 8pt of padding over a default body line, under a
    // comment claiming it matched a list it did not. A floor nothing measures
    // is a comment.
    render(<Host />);
    fireEvent.changeText(screen.getByTestId('home-city'), 'Muni');
    // The pressable itself, not a box inside it: the number has to describe
    // the area that actually answers a thumb.
    const row = screen.getByLabelText('Munich, Germany');
    const style = StyleSheet.flatten(row.props.style) as { minHeight?: number };
    expect(style.minHeight).toBeGreaterThanOrEqual(HitTarget);
  });

  it('names the region only when one name repeats in the results', () => {
    // Five US Springfields exist. Naming the state on every row instead is
    // noise on the other ninety-nine per cent of searches.
    answer([
      city({ id: 2, name: 'Springfield', country_code: 'US', country_name: 'United States' }),
      city({
        id: 3,
        name: 'Springfield',
        country_code: 'US',
        country_name: 'United States',
        admin: 'Illinois',
      }),
    ]);
    render(<Host />);
    fireEvent.changeText(screen.getByTestId('home-city'), 'Spring');
    expect(screen.getByText(/, Illinois, United States/)).toBeTruthy();
  });
});

/**
 * The failure this repo keeps paying for: a capability with nothing on the
 * other end. A shared field only shared with one caller is the same defect as
 * a screen nothing reaches - and it was one caller, because signup went on
 * hand-rolling its own list in the same change that extracted this. The two
 * copies had already drifted the way a shared component exists to stop: the
 * inline row carried no minHeight at all, which put it around 39pt against a
 * 44pt floor, and painted a different ground.
 *
 * So this describe is plural, and it names both.
 */
describe('the forms that ask for a city', () => {
  it('is mounted by Edit profile, which is the only one every account sees', () => {
    const edit = src('src/app/edit-profile.tsx');
    expect(edit).toContain("import { CityField } from '@/components/form/city-field';");
    const field = edit.indexOf('<CityField');
    expect(field).toBeGreaterThan(-1);
    expect(edit.slice(field, field + 400)).toContain('label="Home city"');
    // The country is taken from the picked row, not left to be retyped.
    expect(edit.slice(field, field + 400)).toContain('setCountry(choice.country_name)');
    // And the bare free-text pair it replaced is gone.
    expect(edit).not.toContain('<FormTextField label="Home city"');
  });

  it('is mounted by signup, where the typeahead used to live alone', () => {
    const signup = src('src/app/onboarding/index.tsx');
    expect(signup).toContain("import { CityField } from '@/components/form/city-field';");
    const field = signup.indexOf('<CityField');
    expect(field).toBeGreaterThan(-1);
    // The handle e2e/flows/onboarding-tour.yml drives. Moving the field to a
    // shared component must not move the testID off it.
    expect(signup.slice(field, field + 400)).toContain('testID="city-input"');
    expect(signup).toContain('testID="country-input"');
  });

  it('is the only city list in either form, so neither can drift again', () => {
    const signup = src('src/app/onboarding/index.tsx');
    // The second copy, by every name it went under: its own query, its own
    // rows, and its own undersized style.
    expect(signup).not.toContain('useCitySearch');
    expect(signup).not.toContain('citySuggestions');
    expect(signup).not.toContain('styles.suggestion');
    expect(src('src/app/edit-profile.tsx')).not.toContain('useCitySearch');
  });
});
