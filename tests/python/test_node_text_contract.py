import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from nodes import ABCScore, EXAMPLE_ABC


def test_echoes_effective_text_verbatim():
    out = ABCScore().main(EXAMPLE_ABC)
    assert out["result"] == (EXAMPLE_ABC,)
    assert out["ui"]["text"] == (EXAMPLE_ABC,)


def test_multi_tune_and_odd_whitespace_pass_through_byte_identical():
    abc = "X:1\r\nK:C\nC D\r\n\r\n\n\nX:2\t\nK:G\n % comment\n   A2\tz\n"
    out = ABCScore().main(abc)
    assert out["result"][0] == abc
    assert out["ui"]["text"][0] == abc


def test_output_arity_is_one_string():
    assert ABCScore.RETURN_TYPES == ("STRING",)
    out = ABCScore().main("X:1\nK:C\nC\n")
    assert len(out["result"]) == 1


def test_input_types_expose_single_multiline_string_with_default():
    spec = ABCScore.INPUT_TYPES()["required"]["abc"]
    assert spec[0] == "STRING"
    assert spec[1]["multiline"] is True
    assert spec[1]["default"] == EXAMPLE_ABC
