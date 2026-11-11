import {calculate, evaluate, formatNumber, isCalculation, MAX_DEPTH, MAX_LENGTH} from '../build/search/calc.js';
import {assert, assertEquals, run, test} from './harness.js';

const ev = s => evaluate(s);

test('basic arithmetic and precedence', () => {
    assertEquals(ev('2+2'), 4);
    assertEquals(ev('2+3*4'), 14);
    assertEquals(ev('(2+3)*4'), 20);
    assertEquals(ev('10-4-3'), 3); // left associative
    assertEquals(ev('100/10/5'), 2);
    assertEquals(ev('(3.5*4)/2'), 7);
    assertEquals(ev('7 % 4'), 3);
    assertEquals(ev('2*3%4'), 2); // * and % share a level, left to right
});

test('^ is right associative and binds tighter than unary minus', () => {
    assertEquals(ev('2^3^2'), 512);
    assertEquals(ev('2^10'), 1024);
    assertEquals(ev('-2^2'), -4);
    assertEquals(ev('2^-1'), 0.5);
    assertEquals(ev('2**3'), 8);
    assertEquals(ev('(-2)^2'), 4);
    assertEquals(ev('2*3^2'), 18);
});

test('unary signs, decimals and exponents', () => {
    assertEquals(ev('-3 + 4e2'), 397);
    assertEquals(ev('--3'), 3);
    assertEquals(ev('+3'), 3);
    assertEquals(ev('3 - -3'), 6);
    assertEquals(ev('.5+.5'), 1);
    assertEquals(ev('1.5E-3*1000'), 1.5);
    assertEquals(ev('5.'), 5);
});

test('unicode operators', () => {
    assertEquals(ev('6×7'), 42);
    assertEquals(ev('84 ÷ 2'), 42);
    assertEquals(ev('5 − 8'), -3);
    assertEquals(ev('2·3'), 6);
});

test('percentages', () => {
    assertEquals(ev('15% of 80'), 12);
    assertEquals(ev('50%'), 0.5);
    assertEquals(ev('200 + 10%'), 220);
    assertEquals(ev('200 - 10%'), 180);
    assertEquals(ev('(10 + 10)% of 50'), 10);
    assertEquals(ev('10 % 3'), 1); // a value follows: modulo
    assertEquals(ev('20 % (2+1)'), 2);
});

test('constants and functions', () => {
    assertEquals(ev('sqrt(16)'), 4);
    assertEquals(ev('abs(-3.5)'), 3.5);
    assertEquals(ev('round(2.5)'), 3);
    assertEquals(ev('floor(-1.5)'), -2);
    assertEquals(ev('ceil(1.2)'), 2);
    assertEquals(ev('ln(e)'), 1);
    assertEquals(ev('log(1000)'), 3);
    assertEquals(ev('sin(0)'), 0);
    assertEquals(ev('cos(0)'), 1);
    assertEquals(ev('pi*2'), 2 * Math.PI);
    assertEquals(ev('π*2'), 2 * Math.PI);
    assertEquals(ev('SQRT(9)+PI*0'), 3);
    assertEquals(ev('sqrt(sqrt(256))'), 4);
    assert(Math.abs(ev('tan(pi/4)') - 1) < 1e-12);
    assertEquals(ev('2*(3+sqrt(4))'), 10);
});

test('errors give null, never an exception', () => {
    for (const bad of ['', ' ', '2+', '+', '*3', '2**', '(2', '2)', '()', '2 2', '2,5+1', '1.2.3', 'abc', 'sqrt', 'sqrt 4', 'sqrt()',
        '2+*3', 'foo(2)', '1/0', '0/0', '-1/0', 'sqrt(-1)', 'ln(0)', 'ln(-1)', '10^1000', '2e999+1', '2 @ 3', 'x+1', '3 of 4', 'of', '1e', '$5+1',
        'constructor(1)', '__proto__+1', 'toString(2)']) {
        assertEquals(ev(bad), null, JSON.stringify(bad));
        assertEquals(calculate(bad), null, JSON.stringify(bad));
    }
});

test('limits: length and nesting', () => {
    const long = '1+'.repeat(MAX_LENGTH) + '1';
    assertEquals(ev(long), null);
    assertEquals(ev('1+'.repeat(40) + '1'), 41); // within limits
    assertEquals(ev('('.repeat(MAX_DEPTH + 1) + '1' + ')'.repeat(MAX_DEPTH + 1)), null);
    assertEquals(ev('('.repeat(20) + '1' + ')'.repeat(20)), 1);
    assertEquals(ev('-'.repeat(100) + '1'), null);
    assertEquals(ev('1+' + 'sqrt('.repeat(70) + '4' + ')'.repeat(70)), null);
    assertEquals(ev('9'.repeat(400)), null);
});

test('only calculations trigger: a number, a constant or a name is not one', () => {
    for (const plain of ['2048', '3.5', '-5', '+5', 'pi', 'e', '4e2', '  42  ', '1password', 'firefox', '7-zip', 'c++', '']) {
        assertEquals(calculate(plain), null, plain);
        assertEquals(isCalculation(plain), false, plain);
    }
    for (const calc of ['2+2', '2^10', '15% of 80', '50%', 'sqrt(16)', '-3 + 4e2', '1-1', '6×7', 'abs(-2)']) {
        assert(isCalculation(calc), calc);
    }
});

test('calculate returns the formatted text', () => {
    assertEquals(calculate('2+2'), {value: 4, text: '4'});
    assertEquals(calculate('0.1+0.2').text, '0.3');
    assertEquals(calculate('1/3').text, '0.333333333333');
    assertEquals(calculate('2/3').text, '0.666666666667');
    assertEquals(calculate('(3.5*4)/2').text, '7');
    assertEquals(calculate('2^10').text, '1024');
    assertEquals(calculate('2^64').text, '18446744073700000000');
    assertEquals(calculate('1000000*1000000000000').text, '1000000000000000000');
    assertEquals(calculate('10^30').text, '1e30');
    assertEquals(calculate('1/3*1e-10').text, '3.33333333333e-11');
    assertEquals(calculate('5-5').text, '0');
    assertEquals(calculate('0*-1').text, '0'); // never "-0"
});

test('formatNumber: significant digits, no noise, no locale', () => {
    assertEquals(formatNumber(0.1 + 0.2), '0.3');
    assertEquals(formatNumber(1.0000000000001), '1');
    assertEquals(formatNumber(123456789.123456), '123456789.123');
    assertEquals(formatNumber(-0), '0');
    assertEquals(formatNumber(1e21), '1e21');
    assertEquals(formatNumber(1.5e-7), '1.5e-7');
    assertEquals(formatNumber(1234.5, 3), '1230');
    assertEquals(formatNumber(NaN), '');
    assertEquals(formatNumber(Infinity), '');
    assertEquals(formatNumber(3.14159265358979, 8), '3.1415927');
});

run();
