import { describe, expect, it } from 'vitest';
import {
  decimalToMinor,
  minorToDecimal,
  minorUnitDigits,
  money,
} from './api.js';

describe('money formatting', () => {
  it('formats minor units with grouping and the currency symbol', () => {
    expect(money('123456', 'USD')).toBe('$1,234.56');
    expect(money(5, 'usd')).toBe('$0.05');
    expect(money(0n, 'USD')).toBe('$0.00');
  });

  it('uses the decimal places of each currency', () => {
    expect(minorUnitDigits('JPY')).toBe(0);
    expect(money('1500', 'JPY')).toBe('¥1,500');
    expect(minorUnitDigits('EUR')).toBe(2);
  });

  it('keeps every digit of amounts above the float safe range', () => {
    expect(money('900719925474099312', 'USD')).toBe(
      '$9,007,199,254,740,993.12',
    );
  });

  it('shows a dash for values that are not integers', () => {
    expect(money('abc', 'USD')).toBe('—');
  });

  it('converts between decimal text and minor units', () => {
    expect(minorToDecimal('32000', 'USD')).toBe('320.00');
    expect(minorToDecimal('-5', 'USD')).toBe('-0.05');
    expect(decimalToMinor('320', 'USD')).toBe('32000');
    expect(decimalToMinor('12.5', 'USD')).toBe('1250');
    expect(decimalToMinor('1,250.05', 'USD')).toBe('125005');
    expect(decimalToMinor('1.234', 'USD')).toBeUndefined();
    expect(decimalToMinor('-1', 'USD')).toBeUndefined();
    expect(decimalToMinor('', 'USD')).toBeUndefined();
    expect(decimalToMinor('1500', 'JPY')).toBe('1500');
    expect(decimalToMinor('15.5', 'JPY')).toBeUndefined();
  });
});
