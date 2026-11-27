import {calculate, evaluate, formatNumber, groupDigits, isCalculation, MAX_DEPTH, MAX_LENGTH} from '../build/search/calc.js';
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
    for (const bad of ['', ' ', '2+', '+', '*3', '2**', '(2', '2)', '()', '2 2', '2,5+1', '1.2.3', 'abc', 'sqrt', 'sqrt()',
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
    assertEquals(calculate('2^40').text, '1099511627776');
    assertEquals(calculate('0xFFFFFFFFFF + 0').text, '1099511627775');
    assertEquals(calculate('1 << 53').text, '9007199254740992');
    assertEquals(calculate('2^53').text, '9007199254740992');
    assertEquals(calculate('-(2^53)').text, '-9007199254740992');
    assertEquals(calculate('999999999999+2').text, '1000000000001');
    assertEquals(calculate('12345678901234+1').text, '12345678901235');
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
    assertEquals(formatNumber(2 ** 40), '1099511627776');
    assertEquals(formatNumber(2 ** 53), '9007199254740992');
    assertEquals(formatNumber(8000000000000002), '8000000000000000'); // noise above 1e15 stays hidden
    assertEquals(formatNumber(1666666666666666.8), '1666666666670000');
    assertEquals(formatNumber(1073741824, 8), '1073741824');
    assertEquals(formatNumber(1234, 3), '1234');
    assertEquals(formatNumber(NaN), '');
    assertEquals(formatNumber(Infinity), '');
    assertEquals(formatNumber(3.14159265358979, 8), '3.1415927');
});

const near = (a, b, eps = 1e-9) => a !== null && Math.abs(a - b) < eps;

test('new functions, one argument', () => {
    assert(near(ev('asin(1)'), Math.PI / 2));
    assert(near(ev('acos(1)'), 0));
    assert(near(ev('atan(1)'), Math.PI / 4));
    assert(near(ev('sinh(1)'), Math.sinh(1)));
    assert(near(ev('cosh(0)'), 1));
    assert(near(ev('tanh(0)'), 0));
    assert(near(ev('asinh(0)'), 0));
    assert(near(ev('acosh(1)'), 0));
    assert(near(ev('atanh(0)'), 0));
    assertEquals(ev('exp(0)'), 1);
    assertEquals(ev('log2(8)'), 3);
    assertEquals(ev('cbrt(27)'), 3);
    assertEquals(ev('cbrt(-8)'), -2);
    assertEquals(ev('sign(-4)'), -1);
    assertEquals(ev('trunc(-1.9)'), -1);
    assertEquals(ev('fact(5)'), 120);
    assertEquals(ev('factorial(0)'), 1);
    assertEquals(ev('fact(170) > 0'), null);
    assert(ev('fact(170)') > 7e306);
    assertEquals(ev('fact(171)'), null);
    assertEquals(ev('fact(-1)'), null);
    assertEquals(ev('fact(2.5)'), null);
    assertEquals(ev('acos(2)'), null);
    assert(near(ev('deg(pi)'), 180));
    assert(near(ev('rad(180)'), Math.PI));
});

test('multi-argument functions', () => {
    assertEquals(ev('min(3, 1, 2)'), 1);
    assertEquals(ev('max(3, 1, 2)'), 3);
    assertEquals(ev('sum(1,2,3,4)'), 10);
    assertEquals(ev('avg(2, 4, 9)'), 5);
    assertEquals(ev('mean(1, 2)'), 1.5);
    assertEquals(ev('hypot(3, 4)'), 5);
    assertEquals(ev('gcd(12, 18)'), 6);
    assertEquals(ev('gcd(12, 18, 8)'), 2);
    assertEquals(ev('lcm(4, 6)'), 12);
    assertEquals(ev('lcm(4, 6, 10)'), 60);
    assertEquals(ev('pow(2, 10)'), 1024);
    assertEquals(ev('root(27, 3)'), 3);
    assertEquals(ev('root(16, 4)'), 2);
    assertEquals(ev('root(-8, 3)'), -2);
    assertEquals(ev('mod(10, 3)'), 1);
    assert(near(ev('atan2(1, 1)'), Math.PI / 4));
    assertEquals(ev('ncr(5, 2)'), 10);
    assertEquals(ev('ncr(52, 5)'), 2598960);
    assertEquals(ev('npr(5, 2)'), 20);
    assertEquals(ev('log(1000)'), 3);
    assertEquals(calculate('log(8, 2)').text, '3');
    assertEquals(ev('round(2.5)'), 3);
    assertEquals(ev('round(3.14159, 2)'), 3.14);
    assertEquals(ev('round(1.005, 2)'), 1.01);
    assertEquals(ev('round(1234, -2)'), 1200);
    assertEquals(ev('min(1+1, 2*3)'), 2);
    assertEquals(ev('max(sqrt(16), 3)'), 4);
});

test('wrong argument counts and domains', () => {
    for (const bad of ['sin(1,2)', 'min()', 'pow(2)', 'pow(2,3,4)', 'root(8)', 'mod(1)', 'atan2(1)', 'ncr(5)', 'gcd(4)', 'lcm(4)',
        'gcd(1.5, 2)', 'gcd(-4, 2)', 'lcm(2, 0.5)', 'ncr(5, 7)', 'ncr(-1, 0)', 'npr(3, 1.5)', 'log(1, 2, 3)', 'round(1,2,3)',
        'log(8, 1)', 'log(-1)', 'mod(5, 0)', 'root(4, 0)', 'root(-4, 2)', 'round(1.5, 0.5)', 'sqrt(1,)', 'sqrt(,1)', 'max(1,,2)',
        '(1,2)', '1,2', 'sum(1;2)']) {
        assertEquals(ev(bad), null, bad);
        assertEquals(calculate(bad), null, bad);
    }
});

test('constants', () => {
    assertEquals(ev('tau/2'), Math.PI);
    assertEquals(ev('τ/2'), Math.PI);
    assert(near(ev('phi'), 1.6180339887));
    assert(near(ev('φ*1'), 1.6180339887));
    assert(near(ev('phi^2 - phi'), 1));
    assertEquals(ev('PHI*0'), 0);
});

test('postfix: factorial, degrees, powers, roots', () => {
    assertEquals(ev('5!'), 120);
    assertEquals(ev('3!!'), 720);
    assertEquals(ev('(2+3)!'), 120);
    assertEquals(ev('2*3!'), 12);
    assertEquals(ev('0!'), 1);
    assertEquals(ev('(-1)!'), null);
    assertEquals(ev('171!'), null);
    assertEquals(calculate('sin(30°)').text, '0.5');
    assertEquals(calculate('sin(30 deg)').text, '0.5');
    assertEquals(calculate('cos(180°)').text, '-1');
    assertEquals(calculate('sin 30°').text, '0.5');
    assertEquals(calculate('tan(45°)').text, '1');
    assertEquals(ev('5²'), 25);
    assertEquals(ev('2³'), 8);
    assertEquals(ev('(1+2)²'), 9);
    assertEquals(ev('3² + 4²'), 25);
    assertEquals(ev('√16'), 4);
    assertEquals(ev('√(9+16)'), 5);
    assertEquals(ev('∛27'), 3);
    assertEquals(ev('∛(-8)'), -2);
    assertEquals(ev('√16 + 9'), 13);
    assertEquals(ev('2*√9'), 6);
    assertEquals(ev('√(-1)'), null);
    assertEquals(ev('√'), null);
    assert(near(ev('5 deg(1)'), 5 * 180 / Math.PI)); // deg followed by ( is the function
});

test('functions without brackets', () => {
    assertEquals(ev('sqrt 16'), 4);
    assertEquals(ev('sqrt 16 + 9'), 13);
    assertEquals(ev('max 3'), null); // several-value functions need their brackets: "max 3" may be a name
    assertEquals(ev('sum 0'), null);
    assertEquals(ev('max(3)'), 3);
    assertEquals(ev('sqrt 16 * 2'), 8);
    assertEquals(ev('log 100'), 2);
    assertEquals(ev('ln e'), 1);
    assertEquals(ev('abs -3'), 3);
    assertEquals(ev('sqrt sqrt 256'), 4);
    assertEquals(ev('sqrt (9+16)'), 5);
    assertEquals(calculate('sin pi').text, '0');
    assertEquals(calculate('cos(pi/2)').text, '0');
    assertEquals(calculate('sin(pi)').text, '0');
    assertEquals(calculate('sin(2*pi)').text, '0');
    assertEquals(calculate('tan(0)').text, '0');
    assertEquals(calculate('fact 5').text, '120');
    assertEquals(calculate('sqrt 2').text, '1.41421356237');
    assertEquals(ev('sqrt'), null);
    assertEquals(ev('sin sin'), null);
    assertEquals(ev('sqrt +'), null);
});

test('implicit multiplication', () => {
    assertEquals(ev('2pi'), 2 * Math.PI);
    assertEquals(ev('2 pi'), 2 * Math.PI);
    assertEquals(ev('2(3+4)'), 14);
    assertEquals(ev('2 (3+4)'), 14);
    assertEquals(ev('(1+2)(3+4)'), 21);
    assertEquals(ev('3 sqrt(4)'), 6);
    assertEquals(ev('3sqrt 4'), 6);
    assertEquals(ev('2tau'), 4 * Math.PI);
    assertEquals(ev('2π'), 2 * Math.PI);
    assertEquals(ev('2√9'), 6);
    assertEquals(ev('10 / 2(3)'), 15);
    assertEquals(ev('4(2)^2'), 16);
    assert(isCalculation('2pi'));
    assert(isCalculation('2(3)'));
    for (const bad of ['2e', '2 e', '2 3', '2 3 4', '(1)(', 'pi pi', 'pi 2', 'pi(2)', 'e(2)', '(2)3', '2 min', '4 exp', '2 sqrt', '3 e 4']) {
        assertEquals(ev(bad), null, bad);
        assertEquals(calculate(bad), null, bad);
    }
    assertEquals(ev('2e3'), 2000); // still an exponent
    assertEquals(ev('2 e3'), null);
});

test('hex, binary and octal literals', () => {
    assertEquals(ev('0xFF'), 255);
    assertEquals(ev('0XfF'), 255);
    assertEquals(ev('0b1010'), 10);
    assertEquals(ev('0B11'), 3);
    assertEquals(ev('0o17'), 15);
    assertEquals(ev('0O777'), 511);
    assertEquals(calculate('0xFF + 1').text, '256');
    assertEquals(ev('0x10 * 0b11'), 48);
    for (const bare of ['0xFF', '0b1010', '0o17', '0XFF']) {
        assertEquals(calculate(bare), null, bare);
        assertEquals(isCalculation(bare), false, bare);
    }
    for (const bad of ['0x', '0xG', '0b2', '0o8', '0b12', '0xFFz', '0x1.5']) {
        assertEquals(ev(bad), null, bad);
    }
});

test('bitwise operators', () => {
    assertEquals(ev('1 << 10'), 1024);
    assertEquals(ev('1024 >> 3'), 128);
    assertEquals(ev('0xF0 | 0x0F'), 255);
    assertEquals(ev('6 & 3'), 2);
    assertEquals(ev('5 xor 1'), 4);
    assertEquals(ev('5 XOR 1'), 4);
    assertEquals(ev('1 << 40'), 2 ** 40); // beyond 32 bits
    assertEquals(ev('2^40 | 1'), 2 ** 40 + 1);
    assertEquals(ev('0xFFFFFFFF & 0xF0F0F0F0'), 0xF0F0F0F0);
    assertEquals(ev('-1 & 255'), 255);
    assertEquals(ev('-8 >> 1'), -4);
    assertEquals(ev('1 << 2 + 1'), 8); // shifts bind looser than +
    assertEquals(ev('1 | 2 & 3'), 3); // | lowest, & tighter
    assertEquals(ev('1 | 6 xor 3'), 5); // 1 | (6 xor 3)
    assertEquals(ev('6 xor 3 & 1'), 7); // 6 xor (3 & 1)
    assertEquals(ev('1 << 1 & 3'), 2); // (1<<1) & 3
    assertEquals(ev('(1 | 2) << 1'), 6);
    assertEquals(ev('2^53 | 0'), 2 ** 53);
    assertEquals(ev('2^53 + 2 | 0'), null); // beyond 2^53
    assertEquals(ev('1.5 | 1'), null);
    assertEquals(ev('1 & 0.5'), null);
    assertEquals(ev('1 << -1'), null);
    assertEquals(ev('1 << 2000'), null);
    assertEquals(ev('2^53 << 1000'), null); // overflows to infinity
    assertEquals(ev('1 <'), null);
    assertEquals(ev('1 < 2'), null);
    assertEquals(ev('1 >> '), null);
    assertEquals(ev('| 1'), null);
    assertEquals(calculate('1 << 10').text, '1024');
});

test('word operators', () => {
    assertEquals(ev('2 plus 3'), 5);
    assertEquals(ev('7 minus 2'), 5);
    assertEquals(ev('6 times 7'), 42);
    assertEquals(ev('84 divided by 2'), 42);
    assertEquals(ev('84 DIVIDED   BY 2'), 42);
    assertEquals(ev('10 mod 3'), 1);
    assertEquals(ev('10 MOD 4'), 2);
    assertEquals(ev('mod(10, 3)'), 1);
    assertEquals(ev('5 squared'), 25);
    assertEquals(ev('3 cubed'), 27);
    assertEquals(ev('(1+1) squared'), 4);
    assertEquals(ev('2 to the power of 10'), 1024);
    assertEquals(ev('2 to the power of 3 to the power of 2'), 512);
    assertEquals(ev('2 plus 3 times 4'), 14);
    assertEquals(ev('20% off 80'), 64);
    assertEquals(ev('25% off 200'), 150);
    assertEquals(ev('15% of 80'), 12);
    assertEquals(ev('20 off 80'), null);
    assertEquals(ev('off 80'), null);
    assertEquals(ev('10 mod 0'), null);
    assertEquals(ev('10 divided 2'), null);
    assertEquals(ev('2 to the power 3'), null);
    assert(isCalculation('5 squared'));
});

test('input tidying', () => {
    assertEquals(ev('what is 15% of 80?'), 12);
    assertEquals(ev('What is 2+2'), 4);
    assertEquals(ev('whats 2+2'), 4);
    assertEquals(ev("what's 2+2?"), 4);
    assertEquals(ev('what’s 2+2'), 4);
    assertEquals(ev('calc 2+2'), 4);
    assertEquals(ev('calculate 2+2'), 4);
    assertEquals(ev('= 2+2'), 4);
    assertEquals(ev('=2+2'), 4);
    assertEquals(ev('2+2 ='), 4);
    assertEquals(ev('2+2?'), 4);
    assertEquals(ev('  = 2+2 = '), 4);
    assertEquals(calculate('what is 15% of 80?'), {value: 12, text: '12'});
    assertEquals(calculate('calc(2+3)').text, '5');
    for (const bare of ['what is 5', '= 5', '5 =', 'what is pi?', 'calc 7', 'what is', 'calc', 'calculate', 'whats', '=', '?', 'what is ?']) {
        assertEquals(calculate(bare), null, bare);
    }
    assertEquals(ev('calculator 2+2'), null);
    assertEquals(ev('calc2+2'), null);
    assertEquals(ev('2=2'), null);
    assertEquals(ev('2+?2'), null);
});

test('limits on the new recursion paths', () => {
    assertEquals(ev('sin '.repeat(70) + '1'), null);
    assertEquals(ev('sin '.repeat(10) + '0'), 0);
    assertEquals(ev('√'.repeat(70) + '1'), null);
    assertEquals(ev('√'.repeat(5) + '4294967296'), 2);
    assertEquals(ev('-sqrt '.repeat(70) + '1'), null);
    assertEquals(ev('cbrt '.repeat(100) + '1'), null);
    assertEquals(ev('max('.repeat(70) + '1' + ')'.repeat(70)), null);
    assertEquals(ev('2^'.repeat(70) + '1'), null);
    assertEquals(ev('(2)'.repeat(70)), null); // token limit
    assertEquals(ev('1!'.repeat(150)), null);
    assertEquals(ev('1<<1'.repeat(MAX_LENGTH)), null);
    assertEquals(ev('1,'.repeat(100)), null);
    assertEquals(ev('sum(' + '1,'.repeat(50) + '1)'), 51);
    assertEquals(ev('sum(' + '1,'.repeat(130) + '1)'), null);
});

test('false positives stay null', () => {
    for (const q of ['e', 'pi', 'min', 'max', 'sum', 'x', 'sin', 'log', '2048', '7zip', '3d', '1password', '2e', '5 e', '2 min', '4 exp',
        'mod', 'deg', '0xFF', 'plus', 'times', '3 times', 'steam', 'calc', 'what is', 'fact', '!', 'firefox', 'term', 'settings', 'files',
        'gnome text editor', 'c', 'tau', 'phi', 'minus', 'xor', 'squared', 'avg', 'root', 'ncr', 'to', 'divided by', 'off', 'of', 'vlc',
        'blender 4', '3 d', 'x264', 'Python 3', 'gimp 2.10', '30°', '30 deg', 'what', 'whats up', 'wine', 'celluloid']) {
        assertEquals(calculate(q), null, q);
        assertEquals(isCalculation(q), false, q);
    }
    assertEquals(calculate('100%') !== null, true);
});

test('groupDigits', () => {
    assertEquals(groupDigits('1234567.891'), '1 234 567.891');
    assertEquals(groupDigits('1234'), '1234');
    assertEquals(groupDigits('12345'), '12 345');
    assertEquals(groupDigits('-12345'), '-12 345');
    assertEquals(groupDigits('-1234'), '-1234');
    assertEquals(groupDigits('1.5e21'), '1.5e21');
    assertEquals(groupDigits('1e30'), '1e30');
    assertEquals(groupDigits('0.123456'), '0.123456');
    assertEquals(groupDigits('1234.56789'), '1234.56789');
    assertEquals(groupDigits('100000'), '100 000');
    assertEquals(groupDigits('1000000000000000000'), '1 000 000 000 000 000 000');
    assertEquals(groupDigits(''), '');
    assertEquals(groupDigits('abc'), 'abc');
    assertEquals(groupDigits(formatNumber(2 ** 40)), '1 099 511 627 776');
});

run();
