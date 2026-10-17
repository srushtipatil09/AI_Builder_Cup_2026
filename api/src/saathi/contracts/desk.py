"""Care Desk schema contracts matching frontend types."""

from typing import Literal, Optional
from pydantic import BaseModel, Field


class Profile(BaseModel):
    preferredName: str = ""
    language: str = "Hindi"
    city: str = ""
    persona: Literal["Saathi", "Rakshak"] = "Saathi"
    checkIn: str = ""
    quietHours: str = ""


class Person(BaseModel):
    id: str
    name: str
    relation: str = ""
    city: str = ""


class Memory(BaseModel):
    id: str
    text: str
    author: str
    addedAt: str
    editedAt: Optional[str] = None


class Medicine(BaseModel):
    """Any reminder. Older records have no kind and are medicines."""

    id: str
    kind: Literal["medicine", "exercise", "call", "meal", "other"] = "medicine"
    name: str
    dose: str = ""
    schedule: Literal["Once", "Daily"] = "Daily"
    date: Optional[str] = ""
    time: str = ""
    note: str = ""
    confirmedOn: Optional[str] = None
    confirmedBy: Optional[str] = None
    # The local date a phone accepted the push. Seeing it is not the parent saying they will do it.
    seenOn: Optional[str] = None


class Contact(BaseModel):
    id: str
    name: str
    relation: str = ""
    phone: str = ""
    local: bool = False


class Desk(BaseModel):
    profile: Profile = Field(default_factory=Profile)
    people: list[Person] = Field(default_factory=list)
    memories: list[Memory] = Field(default_factory=list)
    medicines: list[Medicine] = Field(default_factory=list)
    contacts: list[Contact] = Field(default_factory=list)


def create_demo_desk() -> Desk:
    """Synthetic Kamla Sharma demo desk."""
    return Desk(
        profile=Profile(
            preferredName="Kamla",
            language="Hindi",
            city="Varanasi",
            persona="Saathi",
            checkIn="",
            quietHours="",
        ),
        people=[
            Person(id="rahul", name="Rahul", relation="Son", city="Bengaluru"),
        ],
        memories=[],
        medicines=[
            Medicine(id="bp", name="BP tablet", dose="5mg", schedule="Daily", time="08:30", note="after breakfast"),
        ],
        contacts=[
            Contact(id="rahul", name="Rahul", relation="Son, caretaker", phone="+91 98765 43210", local=False),
        ],
    )
