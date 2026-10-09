from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class Entity(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=160)
    kind: Literal["person", "organization", "technology", "project", "other"]


class Relationship(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: str = Field(min_length=1, max_length=160)
    target: str = Field(min_length=1, max_length=160)
    relation: Literal["USES", "WORKS_AT", "BUILT", "RELATED_TO"]


class Extraction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    summary: str = Field(min_length=1, max_length=4000)
    entities: list[Entity] = Field(max_length=50)
    relationships: list[Relationship] = Field(max_length=100)

    @model_validator(mode="after")
    def valid_references(self):
        names = {e.name for e in self.entities}
        if len(names) != len(self.entities):
            raise ValueError("Duplicate entity names")
        if any(r.source not in names or r.target not in names for r in self.relationships):
            raise ValueError("Relationship references unknown entity")
        return self


class Prediction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str = Field(min_length=1, max_length=100)
    confidence: float = Field(ge=0, le=1)
    model_version: str = Field(min_length=1, max_length=100)
    demo: bool


def gemini_extraction_schema():
    """Use Gemini's supported Schema subset; enforce extra-field rules locally."""
    schema = Extraction.model_json_schema()
    definitions = schema.get("$defs", {})
    def supported(value):
        if isinstance(value, dict):
            if "$ref" in value:
                value = {**definitions[value["$ref"].rsplit("/", 1)[-1]], **{key: item for key, item in value.items() if key != "$ref"}}
            result = {}
            for key in ("type", "description", "enum", "required", "items", "properties"):
                if key not in value:
                    continue
                if key == "type":
                    result[key] = value[key].upper()
                else:
                    result[key] = {name: supported(item) for name, item in value[key].items()} if key == "properties" else supported(value[key])
            return result
        if isinstance(value, list):
            return [supported(item) for item in value]
        return value
    return supported(schema)
